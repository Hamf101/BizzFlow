import { afterEach, describe, expect, it, vi } from "vitest"

import { sendTaskEmail, type SendTaskEmailInput } from "@/services/task-service"

const originalEnv = { ...process.env }

const TASK_ID = "30000000-0000-4000-8000-000000000001"

function createInput(
  overrides: Partial<SendTaskEmailInput> = {}
): SendTaskEmailInput {
  return {
    kind: "reminder",
    deliveryReference: `task-reminder/${TASK_ID}`,
    taskId: TASK_ID,
    taskTitle: "Collect signed lease & W-9",
    dueAt: "2026-07-31T09:00:00.000Z",
    recipientEmail: "staff@example.com",
    recipientName: "Sam Staff",
    ...overrides,
  }
}

function stubEmailJsEnv(): void {
  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
    EMAILJS_SERVICE_ID: "service_buy2dql",
    EMAILJS_TEMPLATE_ID: "template_d6o6c8p",
    EMAILJS_PUBLIC_KEY: "public-test-key",
    EMAILJS_PRIVATE_KEY: "private-test-key",
    EMAIL_REPLY_TO_EMAIL: "support@example.com",
  }
}

describe("sendTaskEmail", () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("sends through EmailJS with the delivery reference as trace metadata", async () => {
    stubEmailJsEnv()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "email-1" }), { status: 200 })
      )
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "info").mockImplementation(() => {})

    await sendTaskEmail(createInput())

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.emailjs.com/api/v1.0/email/send",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    )

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as Record<string, unknown>

    expect(body).toMatchObject({
      service_id: "service_buy2dql",
      template_id: "template_d6o6c8p",
      user_id: "public-test-key",
      accessToken: "private-test-key",
    })
    const templateParams = body.template_params as Record<string, unknown>

    expect(templateParams).toMatchObject({
      to_email: "staff@example.com",
      reply_to: "support@example.com",
      subject: "Task reminder: Collect signed lease & W-9",
      delivery_reference: `task-reminder/${TASK_ID}`,
    })
    expect(String(templateParams.message_html)).toContain(
      "Collect signed lease &amp; W-9"
    )
    expect(String(templateParams.message_html)).toContain(
      `https://app.example.com/tasks/${TASK_ID}`
    )
    expect(String(templateParams.message_html)).toContain("Jul 31, 2026")
    expect(String(templateParams.message_text)).toContain("Reminder for your task")
  })

  it("uses assignment copy for an assignment notification", async () => {
    stubEmailJsEnv()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "email-2" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "info").mockImplementation(() => {})

    await sendTaskEmail(createInput({ kind: "assigned", dueAt: null }))

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as Record<string, unknown>
    const templateParams = body.template_params as Record<string, unknown>

    expect(String(templateParams.subject)).toContain("New task assigned")
    expect(String(templateParams.message_html)).toContain(
      "A task was assigned to you"
    )
    expect(String(templateParams.message_html)).not.toContain("Due ")
  })

  it("rejects with a configuration error when EmailJS is not configured", async () => {
    process.env = {
      ...originalEnv,
      EMAILJS_SERVICE_ID: "",
      EMAILJS_TEMPLATE_ID: "",
      EMAILJS_PUBLIC_KEY: "",
    }
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(sendTaskEmail(createInput())).rejects.toMatchObject({
      statusCode: 500,
    })
  })

  it("never leaks provider or recipient detail into the failure path", async () => {
    stubEmailJsEnv()
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("sensitive provider network detail"))
    )

    await expect(sendTaskEmail(createInput())).rejects.toMatchObject({
      message: "Unable to send the task email. Try again shortly.",
      statusCode: 502,
    })
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      "sensitive provider network detail"
    )
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      "staff@example.com"
    )
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("private-test-key")
  })

  it("supports an injected transport for domain-level tests", async () => {
    stubEmailJsEnv()
    vi.spyOn(console, "info").mockImplementation(() => {})
    const transport = vi
      .fn()
      .mockResolvedValue({ providerStatus: 202, providerMessageId: "email-3" })

    await sendTaskEmail(createInput(), { transport })

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryReference: `task-reminder/${TASK_ID}`,
      }),
      expect.objectContaining({
        EMAIL_PROVIDER: "emailjs",
        EMAILJS_SERVICE_ID: "service_buy2dql",
      })
    )
  })
})
