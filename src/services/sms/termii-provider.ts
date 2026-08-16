import type { SmsEnv } from "@/lib/env"
import type {
  SendSmsInput,
  SendSmsResult,
  SmsProvider,
} from "@/services/sms/contracts"

export type TermiiProviderDeps = {
  fetchImpl?: typeof fetch
}

/** Error raised when Termii API returns a non-success response. */
export class TermiiProviderError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "TermiiProviderError"
    this.statusCode = statusCode
  }
}

/**
 * Real Termii SMS infrastructure provider.
 *
 * Dispatches plain SMS messages via Termii REST API `POST /api/sms/send`.
 */
export class TermiiSmsProvider implements SmsProvider {
  private readonly apiKey: string
  private readonly senderId: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(env: SmsEnv, deps: TermiiProviderDeps = {}) {
    if (!env.TERMII_API_KEY) {
      throw new Error("Termii API key is required when using termii provider.")
    }

    this.apiKey = env.TERMII_API_KEY
    this.senderId = env.TERMII_SENDER_ID
    this.baseUrl = env.TERMII_BASE_URL.replace(/\/+$/, "")
    this.timeoutMs = env.SMS_TIMEOUT_MS
    this.fetchImpl = deps.fetchImpl ?? fetch
  }

  async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    const startedAt = Date.now()
    const endpoint = `${this.baseUrl}/sms/send`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          to: input.recipientPhone,
          from: this.senderId,
          sms: input.message,
          type: "plain",
          channel: "generic",
        }),
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (!response.ok) {
        const errorText = await response.text().catch(() => "")
        console.warn("termii_sms_request_failed", {
          reference: input.reference,
          statusCode: response.status,
          durationMs: Date.now() - startedAt,
        })

        return {
          success: false,
          error: `Termii API returned HTTP status ${response.status}: ${errorText.slice(0, 100)}`,
        }
      }

      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
      const messageId = typeof data.message_id === "string" ? data.message_id : undefined

      console.info("termii_sms_sent", {
        reference: input.reference,
        messageId,
        durationMs: Date.now() - startedAt,
      })

      return {
        success: true,
        messageId,
      }
    } catch (error: unknown) {
      clearTimeout(timeout)
      const isAbort = error instanceof Error && error.name === "AbortError"
      const reason = isAbort
        ? `SMS dispatch timed out after ${this.timeoutMs}ms.`
        : error instanceof Error
        ? error.message
        : "Unknown Termii dispatch error"

      console.error("termii_sms_error", {
        reference: input.reference,
        reason,
        durationMs: Date.now() - startedAt,
      })

      return {
        success: false,
        error: reason,
      }
    }
  }
}
