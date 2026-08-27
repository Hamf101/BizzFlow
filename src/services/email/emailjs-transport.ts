import type { EmailJsEmailEnv } from "@/lib/env"
import {
  EmailTransportError,
  validateDeliveryReference,
  type SendEmailInput,
  type SendEmailResult,
} from "@/services/email/contracts"

const EMAILJS_SEND_ENDPOINT = "https://api.emailjs.com/api/v1.0/email/send"
const EMAILJS_REQUEST_INTERVAL_MS = 1000

/** Serializes EmailJS requests and preserves the provider's one-send-per-second limit. */
export type EmailJsRequestScheduler = <T>(
  request: () => Promise<T>
) => Promise<T>

export type EmailJsTransportDeps = {
  fetcher?: typeof fetch
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal
  scheduleRequest?: EmailJsRequestScheduler
}

/**
 * Creates an in-process scheduler that spaces EmailJS requests after completion.
 *
 * @param intervalMs - Cooldown between completed and subsequent requests.
 * @param sleep - Injectable delay implementation used by tests.
 * @returns A scheduler that runs one request at a time in arrival order.
 */
export function createEmailJsRequestScheduler(
  intervalMs: number = EMAILJS_REQUEST_INTERVAL_MS,
  sleep: (delayMs: number) => Promise<void> = async (
    delayMs: number
  ): Promise<void> =>
    new Promise((resolve: () => void): void => {
      setTimeout(resolve, delayMs)
    })
): EmailJsRequestScheduler {
  let queue: Promise<void> = Promise.resolve()
  const safeIntervalMs = Math.max(0, intervalMs)

  return async function schedule<T>(
    request: () => Promise<T>
  ): Promise<T> {
    const execution = queue.then(request)
    const wait = async (): Promise<void> => {
      try {
        await sleep(safeIntervalMs)
      } catch {
        // A broken delay implementation must not permanently block later sends.
      }
    }

    queue = execution.then(wait, wait)
    return execution
  }
}

const scheduleEmailJsRequest = createEmailJsRequestScheduler()

/**
 * Sends one transactional email through the EmailJS REST API.
 *
 * The EmailJS template owns recipient and header routing while the application
 * supplies a complete, escaped HTML document through `message_html`.
 *
 * @param input - Internal delivery reference and branded email content.
 * @param environment - Validated EmailJS account, template, and timeout values.
 * @param deps - Optional fetch, timeout, and scheduling dependencies for tests.
 * @returns The EmailJS HTTP status; EmailJS does not return a message id here.
 * @throws EmailTransportError when validation, provider delivery, or networking fails.
 */
export async function sendEmailJsEmail(
  input: SendEmailInput,
  environment: EmailJsEmailEnv,
  deps: EmailJsTransportDeps = {}
): Promise<SendEmailResult> {
  validateDeliveryReference(input.deliveryReference)

  const fetcher = deps.fetcher ?? globalThis.fetch
  const createTimeoutSignal =
    deps.createTimeoutSignal ??
    ((timeoutMs: number): AbortSignal => AbortSignal.timeout(timeoutMs))
  const scheduleRequest = deps.scheduleRequest ?? scheduleEmailJsRequest

  return scheduleRequest(async (): Promise<SendEmailResult> => {
    try {
      const response = await fetcher(EMAILJS_SEND_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: environment.EMAILJS_SERVICE_ID,
          template_id: environment.EMAILJS_TEMPLATE_ID,
          user_id: environment.EMAILJS_PUBLIC_KEY,
          ...(environment.EMAILJS_PRIVATE_KEY
            ? { accessToken: environment.EMAILJS_PRIVATE_KEY }
            : {}),
          template_params: {
            to_email: input.payload.toEmail,
            subject: input.payload.subject,
            message_html: input.payload.html,
            message_text: input.payload.text,
            delivery_reference: input.deliveryReference,
            ...(input.payload.replyTo
              ? { reply_to: input.payload.replyTo }
              : {}),
          },
        }),
        signal: createTimeoutSignal(environment.EMAIL_TIMEOUT_MS),
      })

      if (!response.ok) {
        // Provider bodies can include account or recipient detail; never retain them.
        throw new EmailTransportError("provider_rejected", response.status)
      }

      return {
        providerStatus: response.status,
        providerMessageId: null,
      }
    } catch (error: unknown) {
      if (error instanceof EmailTransportError) {
        throw error
      }

      throw new EmailTransportError("request_failed")
    }
  })
}
