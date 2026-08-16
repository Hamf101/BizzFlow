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

function stubResendEnv(): void {
  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
    RESEND_API_KEY: "re-test-key",
    RESEND_FROM_EMAIL: "docs@example.com",
    RESEND_REPLY_TO_EMAIL: "support@example.com",
  }
}

describe("sendTaskEmail", () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("sends through the shared transport with the delivery reference as the idempotency key", async () => {
    stubResendEnv()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "email-1" }), { status: 200 })
      )
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "info").mockImplementation(() => {})

    await sendTaskEmail(createInput())

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Idempotency-Key": `task-reminder/${TASK_ID}`,
        }),
      })
    )

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as Record<string, unknown>

    expect(body).toMatchObject({
      to: ["staff@example.com"],
      reply_to: "support@example.com",
      subject: "Task reminder: Collect signed lease & W-9",
    })
    expect(String(body.html)).toContain("Collect signed lease &amp; W-9")
    expect(String(body.html)).toContain(
      `https://app.example.com/tasks/${TASK_ID}`
    )
    expect(String(body.html)).toContain("Jul 31, 2026")
    expect(String(body.text)).toContain("Reminder for your task")
  })

  it("uses assignment copy for an assignment notification", async () => {
    stubResendEnv()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "email-2" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "info").mockImplementation(() => {})

    await sendTaskEmail(createInput({ kind: "assigned", dueAt: null }))

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as Record<string, unknown>

    expect(String(body.subject)).toContain("New task assigned")
    expect(String(body.html)).toContain("A task was assigned to you")
    expect(String(body.html)).not.toContain("Due ")
  })

  it("rejects with a configuration error when Resend is not configured", async () => {
    process.env = { ...originalEnv, RESEND_API_KEY: "", RESEND_FROM_EMAIL: "" }
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(sendTaskEmail(createInput())).rejects.toMatchObject({
      statusCode: 500,
    })
  })

  it("never leaks provider or recipient detail into the failure path", async () => {
    stubResendEnv()
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
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("re-test-key")
  })

  it("supports an injected transport for domain-level tests", async () => {
    stubResendEnv()
    vi.spyOn(console, "info").mockImplementation(() => {})
    const transport = vi
      .fn()
      .mockResolvedValue({ providerStatus: 202, providerMessageId: "email-3" })

    await sendTaskEmail(createInput(), { transport })

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryReference: `task-reminder/${TASK_ID}`,
      }),
      expect.objectContaining({ RESEND_FROM_EMAIL: "docs@example.com" })
    )
  })
})
