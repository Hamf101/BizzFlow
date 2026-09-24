import { describe, expect, it, vi } from "vitest"

import type { EmailJsEmailEnv } from "@/lib/env"
import {
  EmailTransportError,
  type SendEmailInput,
} from "@/services/email/contracts"
import {
  createEmailJsRequestScheduler,
  sendEmailJsEmail,
  type EmailJsRequestScheduler,
} from "@/services/email/emailjs-transport"

const environment: EmailJsEmailEnv = {
  EMAIL_PROVIDER: "emailjs",
  EMAILJS_SERVICE_ID: "service_buy2dql",
  EMAILJS_TEMPLATE_ID: "template_d6o6c8p",
  EMAILJS_PUBLIC_KEY: "public-test-key",
  EMAILJS_PRIVATE_KEY: "private-test-key",
  EMAIL_TIMEOUT_MS: 2500,
}

const runImmediately: EmailJsRequestScheduler = async <T>(
  request: () => Promise<T>
): Promise<T> => request()

function createInput(overrides: Partial<SendEmailInput> = {}): SendEmailInput {
  return {
    deliveryReference: "organization-invite/invite-1",
    payload: {
      toEmail: "member@example.com",
      subject: "You're invited",
      html: "<!doctype html><p>Hello</p>",
      text: "Hello",
    },
    ...overrides,
  }
}

describe("sendEmailJsEmail", () => {
  it("posts the dynamic variables expected by the generic EmailJS template", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }))
    const createTimeoutSignal = vi.fn(
      (): AbortSignal => AbortSignal.timeout(60000)
    )

    const result = await sendEmailJsEmail(createInput(), environment, {
      fetcher,
      createTimeoutSignal,
      scheduleRequest: runImmediately,
    })

    expect(result).toEqual({ providerStatus: 200, providerMessageId: null })
    expect(createTimeoutSignal).toHaveBeenCalledWith(2500)

    const [endpoint, request] = fetcher.mock.calls[0] as [string, RequestInit]

    expect(endpoint).toBe("https://api.emailjs.com/api/v1.0/email/send")
    expect(request.headers).toEqual({ "Content-Type": "application/json" })
    expect(JSON.parse(String(request.body))).toEqual({
      service_id: "service_buy2dql",
      template_id: "template_d6o6c8p",
      user_id: "public-test-key",
      accessToken: "private-test-key",
      template_params: {
        to_email: "member@example.com",
        subject: "You're invited",
        message_html: "<!doctype html><p>Hello</p>",
        message_text: "Hello",
        delivery_reference: "organization-invite/invite-1",
      },
    })
  })

  it("includes reply-to only when one is configured", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }))

    await sendEmailJsEmail(
      createInput({
        payload: {
          toEmail: "member@example.com",
          subject: "Subject",
          html: "<p>Hello</p>",
          text: "Hello",
          replyTo: "support@example.com",
        },
      }),
      environment,
      { fetcher, scheduleRequest: runImmediately }
    )

    const request = fetcher.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as {
      template_params: Record<string, unknown>
    }

    expect(body.template_params.reply_to).toBe("support@example.com")
  })

  it("throws provider_rejected without reading the provider error body", async () => {
    const errorBody = vi.fn()
    const response = new Response("sensitive provider detail", { status: 400 })
    vi.spyOn(response, "json").mockImplementation(errorBody)
    vi.spyOn(response, "text").mockImplementation(errorBody)
    const fetcher = vi.fn().mockResolvedValue(response)

    await expect(
      sendEmailJsEmail(createInput(), environment, {
        fetcher,
        scheduleRequest: runImmediately,
      })
    ).rejects.toMatchObject({
      kind: "provider_rejected",
      providerStatus: 400,
      message: "Email delivery failed.",
    } satisfies Partial<EmailTransportError>)
    expect(errorBody).not.toHaveBeenCalled()
  })

  it("paces concurrent sends through one scheduler", async () => {
    let releaseCooldown: (() => void) | undefined
    const sleep = vi.fn(
      (): Promise<void> =>
        new Promise((resolve: () => void): void => {
          releaseCooldown = resolve
        })
    )
    const scheduler = createEmailJsRequestScheduler(1000, sleep)
    const starts: string[] = []

    const first = scheduler(async (): Promise<string> => {
      starts.push("first")
      return "first"
    })
    const second = scheduler(async (): Promise<string> => {
      starts.push("second")
      return "second"
    })

    await expect(first).resolves.toBe("first")
    expect(starts).toEqual(["first"])
    expect(sleep).toHaveBeenCalledWith(1000)

    releaseCooldown?.()

    await expect(second).resolves.toBe("second")
    expect(starts).toEqual(["first", "second"])
  })
})
