import { describe, expect, it, vi } from "vitest"

import {
  executeTemplateFlow,
  type TemplateFlowServiceDeps
} from "@/services/template-flow-service"
import {
  createBlankTemplateContent,
  type TemplateContent
} from "@/types/template"
import type { TemplateFlowMessage } from "@/types/template-flow"

const TEMPLATE_ID = "00000000-0000-4000-8000-000000000010"
const PARAGRAPH_ID = "00000000-0000-4000-8000-000000000011"
const GEMINI_MODEL_CANDIDATES = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview"
]

describe("template Flow service", () => {
  it("applies validated edits, preserves branding bytes, and persists chat", async () => {
    const content = createContent()
    const fetchImpl = vi.fn<typeof fetch>(async (): Promise<Response> =>
      geminiResponse({
        assistantMessage:
          "I tightened the introduction and kept your existing logo.",
        needsConfirmation: false,
        confirmationQuestion: "",
        operations: [
          {
            type: "update_block",
            summary: "Condensed introduction",
            payload: {
              blockId: PARAGRAPH_ID,
              block: {
                type: "paragraph",
                text: "A concise introduction.",
                alignment: "left"
              }
            }
          },
          {
            type: "set_branding",
            summary: "Updated logo placement",
            payload: {
              accentColor: "#635273",
              logoAlignment: "right",
              logoWidthPercent: 32
            }
          }
        ]
      })
    )
    const persistMessages = vi.fn(async (): Promise<void> => {})
    const authorizeTemplateManagement = vi.fn(async (): Promise<void> => {})
    const history: TemplateFlowMessage[] = [
      {
        id: "00000000-0000-4000-8000-000000000099",
        role: "assistant",
        content: "What would you like to improve?",
        authorName: null,
        operations: [],
        changedBlockIds: [],
        createdAt: "2026-07-23T12:00:00.000Z"
      }
    ]

    const result = await executeTemplateFlow(
      createInput(content, "Make the introduction more concise."),
      createDependencies({
        authorizeTemplateManagement,
        fetchImpl,
        loadHistory: async (): Promise<TemplateFlowMessage[]> => history,
        persistMessages
      })
    )

    expect(authorizeTemplateManagement).toHaveBeenCalledWith({
      actorUserId: "user-1",
      organizationId: "org-1",
      templateId: TEMPLATE_ID
    })
    expect(result.draft.content.blocks[0]).toMatchObject({
      id: PARAGRAPH_ID,
      text: "A concise introduction."
    })
    expect(result.draft.content.branding.logoDataUrl).toBe(
      content.branding.logoDataUrl
    )
    expect(result.draft.content.branding.accentColor).toBe("#635273")
    expect(result.draft.content.branding.logoAlignment).toBe("right")
    expect(result.draft.content.branding.logoWidthPercent).toBe(32)
    expect(result.changedBlockIds).toEqual([PARAGRAPH_ID])
    expect(result.messages[1].operations).toHaveLength(2)
    expect(result.messages[1].operations[0]?.target).toContain("Paragraph")
    expect(result.messages[1].operations[1]?.target).toBe("Document branding")
    expect(persistMessages).toHaveBeenCalledTimes(1)

    const requestInit = fetchImpl.mock.calls[0]?.[1]
    const requestBody = JSON.parse(String(requestInit?.body)) as {
      input: string
      store: boolean
      system_instruction: string
      response_format: {
        schema: Record<string, unknown>
      }
    }

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1/interactions"
    )
    expect(requestBody.store).toBe(false)
    expect(requestBody.input).toContain("What would you like to improve?")
    expect(requestBody.input).not.toContain("aGVsbG8=")
    expect(requestBody.system_instruction).toContain(
      "BizFlow's accountable business-document editor"
    )
    expect(requestBody.system_instruction).toContain("intake forms")
    expect(requestBody.system_instruction).toContain("payloadJson")
    const responseSchema = JSON.stringify(requestBody.response_format.schema)
    expect(responseSchema).not.toContain('"anyOf"')
    expect(responseSchema).toContain('"payloadJson"')
    expect(responseSchema).toContain('"remove_block"')
    expect(responseSchema).not.toContain('"target"')
  })

  it("asks before an ambiguous removal and leaves the draft unchanged", async () => {
    const content = createContent()
    const fetchImpl = vi.fn<typeof fetch>(async (): Promise<Response> =>
      geminiResponse({
        assistantMessage: "I can shorten the document.",
        needsConfirmation: false,
        confirmationQuestion: "",
        operations: [
          {
            type: "remove_block",
            summary: "Removed introduction",
            payload: {
              blockId: PARAGRAPH_ID
            }
          }
        ]
      })
    )

    const result = await executeTemplateFlow(
      createInput(content, "Make this document shorter."),
      createDependencies({ fetchImpl })
    )

    expect(result.needsConfirmation).toBe(true)
    expect(result.draft.content.blocks).toEqual(content.blocks)
    expect(result.messages[1].content).toContain("Which content")
    expect(result.messages[1].operations).toEqual([])
  })

  it("keeps appended free-form blocks in provider operation order", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (): Promise<Response> =>
      geminiResponse({
        assistantMessage: "I added the agreement sections in order.",
        needsConfirmation: false,
        confirmationQuestion: "",
        operations: [
          {
            type: "add_block",
            summary: "Added scope heading",
            payload: {
              afterBlockId: null,
              block: {
                type: "heading",
                text: "1. Scope of Services",
                level: 2,
                alignment: "left"
              }
            }
          },
          {
            type: "add_block",
            summary: "Added payment heading",
            payload: {
              afterBlockId: null,
              block: {
                type: "heading",
                text: "2. Payment Terms",
                level: 2,
                alignment: "left"
              }
            }
          }
        ]
      })
    )

    const result = await executeTemplateFlow(
      createInput(createContent(), "Add scope and payment sections."),
      createDependencies({ fetchImpl })
    )

    expect(
      result.draft.content.blocks
        .filter((block): boolean => block.type === "heading")
        .map((block): string => (block.type === "heading" ? block.text : ""))
    ).toEqual(["1. Scope of Services", "2. Payment Terms"])
  })

  it("creates a canonical bulleted list in a blank free-form draft", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (): Promise<Response> =>
      geminiResponse({
        assistantMessage: "I added the requested service list.",
        needsConfirmation: false,
        confirmationQuestion: "",
        operations: [
          {
            type: "add_block",
            summary: "Added service list",
            payload: {
              afterBlockId: null,
              block: {
                type: "bullet_list",
                items: ["Discovery", "Implementation", "Handoff"]
              }
            }
          }
        ]
      })
    )
    const content = createBlankTemplateContent()

    const result = await executeTemplateFlow(
      createInput(content, "Create a short list of services."),
      createDependencies({ fetchImpl })
    )

    expect(result.draft.content.blocks).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000100",
        type: "bullet_list",
        items: ["Discovery", "Implementation", "Handoff"]
      }
    ])
    expect(result.messages[1].operations[0]?.target).toBe("Bulleted list")
  })

  it("allows explicit removal while keeping publication state out of scope", async () => {
    const content = createContent()
    const fetchImpl = vi.fn<typeof fetch>(async (): Promise<Response> =>
      geminiResponse({
        assistantMessage: "I removed the introduction.",
        needsConfirmation: false,
        confirmationQuestion: "",
        operations: [
          {
            type: "remove_block",
            summary: "Removed introduction",
            payload: {
              blockId: PARAGRAPH_ID
            }
          }
        ]
      })
    )

    const result = await executeTemplateFlow(
      createInput(content, "Delete the introduction."),
      createDependencies({ fetchImpl })
    )

    expect(result.needsConfirmation).toBe(false)
    expect(result.draft.content.blocks).toEqual([])
    expect(result.changedBlockIds).toEqual([PARAGRAPH_ID])
  })

  it("requires an explicit logo-removal request even when other deletion is requested", async () => {
    const content = createContent()
    const fetchImpl = vi.fn<typeof fetch>(async (): Promise<Response> =>
      geminiResponse({
        assistantMessage: "I removed the requested content.",
        needsConfirmation: false,
        confirmationQuestion: "",
        operations: [
          {
            type: "set_branding",
            summary: "Removed logo",
            payload: { removeLogo: true }
          }
        ]
      })
    )

    const result = await executeTemplateFlow(
      createInput(content, "Delete the introduction."),
      createDependencies({ fetchImpl })
    )

    expect(result.needsConfirmation).toBe(true)
    expect(result.messages[1].content).toContain("existing logo")
    expect(result.draft.content.branding.logoDataUrl).toBe(
      content.branding.logoDataUrl
    )
  })

  it.each([
    {
      rateLimitedResponseCount: 1,
      expectedModels: GEMINI_MODEL_CANDIDATES.slice(0, 2)
    },
    {
      rateLimitedResponseCount: 3,
      expectedModels: GEMINI_MODEL_CANDIDATES.slice(0, 4)
    }
  ])(
    "completes with a fallback after $rateLimitedResponseCount rate-limited response(s)",
    async ({ rateLimitedResponseCount, expectedModels }): Promise<void> => {
      let responseCount = 0
      const fetchImpl = vi.fn<typeof fetch>(async (): Promise<Response> => {
        responseCount += 1
        return responseCount <= rateLimitedResponseCount
          ? geminiRateLimitResponse()
          : successfulGeminiResponse()
      })

      const result = await executeTemplateFlow(
        createInput(createBlankTemplateContent(), "Create an agreement."),
        createDependencies({ fetchImpl })
      )

      expect(result.needsConfirmation).toBe(false)
      expect(
        fetchImpl.mock.calls.map((call): string =>
          readRequestedModel(call[1])
        )
      ).toEqual(expectedModels)
    }
  )

  it("tries the exact model order and preserves the safe error when all quotas are exhausted", async () => {
    const signals: Array<AbortSignal | null | undefined> = []
    const fetchImpl = vi.fn<typeof fetch>(
      async (
        _input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        signals.push(init?.signal)
        return geminiRateLimitResponse()
      }
    )

    await expect(
      executeTemplateFlow(
        createInput(createBlankTemplateContent(), "Create an agreement."),
        createDependencies({ fetchImpl })
      )
    ).rejects.toMatchObject({
      statusCode: 429,
      message:
        "Flow has reached the Gemini rate limit. Wait a minute and try again."
    })
    expect(
      fetchImpl.mock.calls.map((call): string => readRequestedModel(call[1]))
    ).toEqual(GEMINI_MODEL_CANDIDATES)
    expect(new Set(signals).size).toBe(1)
  })

  it("skips a duplicate when the configured primary is already a fallback model", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async (): Promise<Response> => geminiRateLimitResponse()
    )

    await expect(
      executeTemplateFlow(
        createInput(createBlankTemplateContent(), "Create an agreement."),
        createDependencies({
          fetchImpl,
          getConfig: () => ({
            GEMINI_API_KEY: "test-gemini-key",
            GEMINI_MODEL: "gemini-3.5-flash",
            GEMINI_TIMEOUT_MS: 10_000
          })
        })
      )
    ).rejects.toMatchObject({ statusCode: 429 })
    expect(
      fetchImpl.mock.calls.map((call): string => readRequestedModel(call[1]))
    ).toEqual(GEMINI_MODEL_CANDIDATES.slice(1))
  })

  it.each([400, 401, 403])(
    "does not switch models for a non-quota HTTP %i response",
    async (status: number): Promise<void> => {
      const fetchImpl = vi.fn<typeof fetch>(
        async (): Promise<Response> => new Response("Rejected", { status })
      )

      await expect(
        executeTemplateFlow(
          createInput(createBlankTemplateContent(), "Create an agreement."),
          createDependencies({ fetchImpl })
        )
      ).rejects.toMatchObject({
        statusCode: 502,
        message: "Flow could not update the document. Try again shortly."
      })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(readRequestedModel(fetchImpl.mock.calls[0]?.[1])).toBe(
        "gemini-3.6-flash"
      )
    }
  )

  it("continues to a supported Gemini fallback when a model is unavailable", async () => {
    let responseCount = 0
    const fetchImpl = vi.fn<typeof fetch>(async (): Promise<Response> => {
      responseCount += 1

      return responseCount === 1
        ? new Response("Model unavailable", { status: 404 })
        : successfulGeminiResponse()
    })

    await executeTemplateFlow(
      createInput(createBlankTemplateContent(), "Create an agreement."),
      createDependencies({ fetchImpl })
    )

    expect(
      fetchImpl.mock.calls.map((call): string => readRequestedModel(call[1]))
    ).toEqual(GEMINI_MODEL_CANDIDATES.slice(0, 2))
  })

  it.each([408, 503])(
    "retries HTTP %i on the same model without falling back",
    async (status: number): Promise<void> => {
      const fetchImpl = vi.fn<typeof fetch>(
        async (): Promise<Response> => new Response("Retry", { status })
      )

      await expect(
        executeTemplateFlow(
          createInput(createBlankTemplateContent(), "Create an agreement."),
          createDependencies({ fetchImpl })
        )
      ).rejects.toMatchObject({ statusCode: 502 })
      expect(
        fetchImpl.mock.calls.map((call): string =>
          readRequestedModel(call[1])
        )
      ).toEqual([
        "gemini-3.6-flash",
        "gemini-3.6-flash",
        "gemini-3.6-flash"
      ])
    }
  )

  it("retries network failures on the same model without falling back", async () => {
    let requestCount = 0
    const fetchImpl = vi.fn<typeof fetch>(async (): Promise<Response> => {
      requestCount += 1

      if (requestCount < 3) {
        throw new TypeError("Network unavailable")
      }

      return successfulGeminiResponse()
    })

    await executeTemplateFlow(
      createInput(createBlankTemplateContent(), "Create an agreement."),
      createDependencies({ fetchImpl })
    )

    expect(
      fetchImpl.mock.calls.map((call): string => readRequestedModel(call[1]))
    ).toEqual([
      "gemini-3.6-flash",
      "gemini-3.6-flash",
      "gemini-3.6-flash"
    ])
  })

  it("logs fallback context and the model that completed the turn", async () => {
    let responseCount = 0
    const fetchImpl = vi.fn<typeof fetch>(async (): Promise<Response> => {
      responseCount += 1
      return responseCount === 1
        ? geminiRateLimitResponse()
        : successfulGeminiResponse()
    })
    const infoSpy = vi.spyOn(console, "info").mockImplementation((): void => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {})

    try {
      await executeTemplateFlow(
        createInput(createBlankTemplateContent(), "Create an agreement."),
        createDependencies({ fetchImpl })
      )

      expect(warnSpy).toHaveBeenCalledWith(
        "template_flow_provider_fallback",
        expect.objectContaining({
          actorUserId: "user-1",
          organizationId: "org-1",
          templateId: TEMPLATE_ID,
          exhaustedModel: "gemini-3.6-flash",
          nextModel: "gemini-3.5-flash",
          status: 429,
          durationMs: expect.any(Number)
        })
      )
      expect(infoSpy).toHaveBeenCalledWith(
        "template_flow_turn_completed",
        expect.objectContaining({
          actorUserId: "user-1",
          organizationId: "org-1",
          templateId: TEMPLATE_ID,
          model: "gemini-3.5-flash"
        })
      )
    } finally {
      infoSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })

  it("rejects the legacy generic-list shape before changing the draft", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (): Promise<Response> =>
      geminiResponse({
        assistantMessage: "I added a list.",
        needsConfirmation: false,
        confirmationQuestion: "",
        operations: [
          {
            type: "add_block",
            summary: "Added service list",
            payload: {
              afterBlockId: null,
              block: {
                type: "list",
                ordered: false,
                items: [{ text: "Discovery" }]
              }
            }
          }
        ]
      })
    )

    await expect(
      executeTemplateFlow(
        createInput(createBlankTemplateContent(), "Add a service list."),
        createDependencies({ fetchImpl })
      )
    ).rejects.toMatchObject({
      statusCode: 502,
      message: "Flow returned changes that failed validation."
    })
  })

  it("rejects unreadable operation payload JSON before changing the draft", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (): Promise<Response> =>
      geminiRawResponse({
        assistantMessage: "I renamed the document.",
        needsConfirmation: false,
        confirmationQuestion: "",
        operations: [
          {
            type: "set_title",
            summary: "Renamed document",
            payloadJson: "not-json"
          }
        ]
      })
    )

    await expect(
      executeTemplateFlow(
        createInput(createBlankTemplateContent(), "Rename the document."),
        createDependencies({ fetchImpl })
      )
    ).rejects.toMatchObject({
      statusCode: 502,
      message: "Flow returned changes that failed validation."
    })
  })
})

function createContent(): TemplateContent {
  const content = createBlankTemplateContent()
  content.branding.logoDataUrl = "data:image/png;base64,aGVsbG8="
  content.blocks = [
    {
      id: PARAGRAPH_ID,
      type: "paragraph",
      text: "A long introduction that needs refinement.",
      alignment: "left"
    }
  ]
  return content
}

function createInput(content: TemplateContent, instruction: string) {
  return {
    actorUserId: "user-1",
    organizationId: "org-1",
    templateId: TEMPLATE_ID,
    draft: {
      title: "Vendor agreement",
      description: "Reusable agreement",
      content
    },
    instruction
  }
}

function createDependencies(
  overrides: Partial<TemplateFlowServiceDeps>
): TemplateFlowServiceDeps {
  let idSequence = 100

  return {
    authorizeTemplateManagement: async (): Promise<void> => {},
    createId: (): string => {
      const suffix = String(idSequence).padStart(12, "0")
      idSequence += 1
      return `00000000-0000-4000-8000-${suffix}`
    },
    delayImpl: async (): Promise<void> => {},
    getConfig: () => ({
      GEMINI_API_KEY: "test-gemini-key",
      GEMINI_MODEL: "gemini-3.6-flash",
      GEMINI_TIMEOUT_MS: 10_000
    }),
    loadHistory: async (): Promise<TemplateFlowMessage[]> => [],
    now: () => new Date("2026-07-23T17:30:00.000Z"),
    persistMessages: async (): Promise<void> => {},
    resolveAuthorName: async (): Promise<string> => "Alex Morgan",
    ...overrides
  }
}

type TestGeminiOperation = {
  type: string
  summary: string
  payload: unknown
}

type TestGeminiPayload = {
  assistantMessage: string
  needsConfirmation: boolean
  confirmationQuestion: string
  operations: TestGeminiOperation[]
}

function geminiResponse(payload: TestGeminiPayload): Response {
  const providerPayload = {
    ...payload,
    operations: payload.operations.map(
      (operation: TestGeminiOperation): Record<string, string> => ({
        type: operation.type,
        summary: operation.summary,
        payloadJson: JSON.stringify(operation.payload)
      })
    )
  }

  return geminiRawResponse(providerPayload)
}

function geminiRawResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      status: "completed",
      steps: [
        {
          type: "model_output",
          content: [{ type: "text", text: JSON.stringify(payload) }]
        }
      ]
    }),
    {
      headers: { "Content-Type": "application/json" },
      status: 200
    }
  )
}

function successfulGeminiResponse(): Response {
  return geminiResponse({
    assistantMessage: "I created the agreement.",
    needsConfirmation: false,
    confirmationQuestion: "",
    operations: []
  })
}

function geminiRateLimitResponse(): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "resource_exhausted",
        message: "Quota exceeded."
      }
    }),
    {
      headers: { "Content-Type": "application/json" },
      status: 429
    }
  )
}

function readRequestedModel(requestInit: RequestInit | undefined): string {
  const requestBody = JSON.parse(String(requestInit?.body)) as {
    model: string
  }
  return requestBody.model
}
