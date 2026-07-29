import { describe, expect, it, vi } from "vitest"

import type {
  AiProvider,
  AiStructuredGenerationRequest,
  AiStructuredGenerationResult
} from "@/services/ai/contracts"
import {
  AI_PROVIDER_ERROR_CODES,
  AiProviderError
} from "@/services/ai/errors"
import {
  executeTemplateFlow,
  type ExecuteTemplateFlowInput,
  type TemplateFlowServiceDeps
} from "@/services/template-flow-service"
import {
  createBlankTemplateContent,
  type TemplateContent
} from "@/types/template"
import type { TemplateFlowMessage } from "@/types/template-flow"

const TEMPLATE_ID = "00000000-0000-4000-8000-000000000010"
const PARAGRAPH_ID = "00000000-0000-4000-8000-000000000011"
const TEST_PROVIDER_ID = "test-provider"
const TEST_MODEL = "test-exact-model"

describe("template Flow service", () => {
  it("applies validated edits, preserves branding bytes, and persists chat", async () => {
    const content = createContent()
    const aiProvider = createTestAiProvider([
      flowProviderResult({
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
    ])
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
        aiProvider,
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

    const providerRequest = readProviderRequests(aiProvider)[0]

    expect(providerRequest?.model).toEqual({
      provider: TEST_PROVIDER_ID,
      model: TEST_MODEL
    })
    expect(providerRequest?.input).toContain("What would you like to improve?")
    expect(providerRequest?.input).not.toContain("aGVsbG8=")
    expect(providerRequest?.systemInstruction).toContain(
      "BizFlow's accountable business-document editor"
    )
    expect(providerRequest?.systemInstruction).toContain("intake forms")
    expect(providerRequest?.systemInstruction).toContain("locked")
    expect(providerRequest?.systemInstruction).toContain("lower_snake_case")
    expect(providerRequest?.systemInstruction).toContain("Needs input:")
    expect(providerRequest?.systemInstruction).toContain(
      "meaningful choices"
    )
    expect(providerRequest?.systemInstruction).toContain("single title")
    expect(providerRequest?.systemInstruction).toContain("payloadJson")
    const responseSchema = JSON.stringify(providerRequest?.responseSchema)
    expect(responseSchema).not.toContain('"anyOf"')
    expect(responseSchema).toContain('"payloadJson"')
    expect(responseSchema).toContain('"remove_block"')
    expect(responseSchema).not.toContain('"target"')
  })

  it("asks before an ambiguous removal and leaves the draft unchanged", async () => {
    const content = createContent()
    const aiProvider = createTestAiProvider([
      flowProviderResult({
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
    ])

    const result = await executeTemplateFlow(
      createInput(content, "Make this document shorter."),
      createDependencies({ aiProvider })
    )

    expect(result.needsConfirmation).toBe(true)
    expect(result.draft.content.blocks).toEqual(content.blocks)
    expect(result.messages[1].content).toContain("Which content")
    expect(result.messages[1].operations).toEqual([])
  })

  it("keeps appended free-form blocks in provider operation order", async () => {
    const aiProvider = createTestAiProvider([
      flowProviderResult({
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
    ])

    const result = await executeTemplateFlow(
      createInput(createContent(), "Add scope and payment sections."),
      createDependencies({ aiProvider })
    )

    expect(
      result.draft.content.blocks
        .filter((block): boolean => block.type === "heading")
        .map((block): string => (block.type === "heading" ? block.text : ""))
    ).toEqual(["1. Scope of Services", "2. Payment Terms"])
  })

  it("creates a canonical bulleted list in a blank free-form draft", async () => {
    const aiProvider = createTestAiProvider([
      flowProviderResult({
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
    ])
    const content = createBlankTemplateContent()

    const result = await executeTemplateFlow(
      createInput(content, "Create a short list of services."),
      createDependencies({ aiProvider })
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
    const aiProvider = createTestAiProvider([
      flowProviderResult({
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
    ])

    const result = await executeTemplateFlow(
      createInput(content, "Delete the introduction."),
      createDependencies({ aiProvider })
    )

    expect(result.needsConfirmation).toBe(false)
    expect(result.draft.content.blocks).toEqual([])
    expect(result.changedBlockIds).toEqual([PARAGRAPH_ID])
  })

  it("requires an explicit logo-removal request even when other deletion is requested", async () => {
    const content = createContent()
    const aiProvider = createTestAiProvider([
      flowProviderResult({
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
    ])

    const result = await executeTemplateFlow(
      createInput(content, "Delete the introduction."),
      createDependencies({ aiProvider })
    )

    expect(result.needsConfirmation).toBe(true)
    expect(result.messages[1].content).toContain("existing logo")
    expect(result.draft.content.branding.logoDataUrl).toBe(
      content.branding.logoDataUrl
    )
  })

  it("uses the configured provider and exact model without fallback", async () => {
    const aiProvider = createTestAiProvider([
      flowProviderResult(successfulFlowPayload())
    ])

    await executeTemplateFlow(
      createInput(createBlankTemplateContent(), "Create an agreement."),
      createDependencies({ aiProvider })
    )

    expect(readProviderRequests(aiProvider)).toHaveLength(1)
    expect(readProviderRequests(aiProvider)[0]?.model).toEqual({
      provider: TEST_PROVIDER_ID,
      model: TEST_MODEL
    })
  })

  it("surfaces a typed provider quota rejection without another call", async () => {
    const providerError = new AiProviderError({
      code: AI_PROVIDER_ERROR_CODES.RATE_LIMITED,
      message: "Provider quota reached.",
      model: { provider: TEST_PROVIDER_ID, model: TEST_MODEL },
      provider: TEST_PROVIDER_ID,
      retryable: true,
      statusCode: 429,
      traceId: "provider-rate-trace"
    })
    const aiProvider = createTestAiProvider([providerError])

    await expect(
      executeTemplateFlow(
        createInput(createBlankTemplateContent(), "Create an agreement."),
        createDependencies({ aiProvider })
      )
    ).rejects.toMatchObject({
      statusCode: 429,
      message:
        "Flow has reached the AI service rate limit. Wait a minute and try again."
    })
    expect(readProviderRequests(aiProvider)).toHaveLength(1)
  })

  it("performs one bounded semantic repair on the same model", async () => {
    const aiProvider = createTestAiProvider([
      {
        ...flowProviderResult(successfulFlowPayload()),
        text: "not-json",
        traceId: "initial-invalid-trace",
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120
        }
      },
      {
        ...flowProviderResult(successfulFlowPayload()),
        traceId: "repair-success-trace",
        usage: {
          inputTokens: 140,
          outputTokens: 30,
          totalTokens: 170
        }
      }
    ])
    const infoSpy = vi.spyOn(console, "info").mockImplementation((): void => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {})

    try {
      await executeTemplateFlow(
        createInput(createBlankTemplateContent(), "Create an agreement."),
        createDependencies({ aiProvider })
      )

      const requests = readProviderRequests(aiProvider)
      expect(requests).toHaveLength(2)
      expect(requests.map((request) => request.model)).toEqual([
        { provider: TEST_PROVIDER_ID, model: TEST_MODEL },
        { provider: TEST_PROVIDER_ID, model: TEST_MODEL }
      ])
      expect(requests[1]?.input).toContain("semanticRepair")
      expect(infoSpy).toHaveBeenCalledWith(
        "template_flow_turn_completed",
        expect.objectContaining({
          provider: TEST_PROVIDER_ID,
          model: TEST_MODEL,
          traceId: "repair-success-trace",
          upstreamCalls: 2,
          inputTokens: 240,
          outputTokens: 50,
          totalTokens: 290
        })
      )
      expect(warnSpy).toHaveBeenCalledWith(
        "template_flow_provider_output_invalid",
        expect.objectContaining({
          provider: TEST_PROVIDER_ID,
          model: TEST_MODEL,
          providerCall: 1,
          issueCode: "invalid_json"
        })
      )
    } finally {
      infoSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })

  it("caps invalid structured output at two upstream calls", async () => {
    const invalidResult = {
      ...flowProviderResult(successfulFlowPayload()),
      text: "not-json"
    }
    const aiProvider = createTestAiProvider([invalidResult, invalidResult])

    await expect(
      executeTemplateFlow(
        createInput(createBlankTemplateContent(), "Create an agreement."),
        createDependencies({ aiProvider })
      )
    ).rejects.toMatchObject({
      statusCode: 502,
      message: "Flow returned changes that failed validation."
    })
    expect(readProviderRequests(aiProvider)).toHaveLength(2)
  })

  it("logs null usage when the provider omits token counts", async () => {
    const aiProvider = createTestAiProvider([
      flowProviderResult(successfulFlowPayload())
    ])
    const infoSpy = vi.spyOn(console, "info").mockImplementation((): void => {})

    try {
      await executeTemplateFlow(
        createInput(createBlankTemplateContent(), "Create an agreement."),
        createDependencies({ aiProvider })
      )

      expect(infoSpy).toHaveBeenCalledWith(
        "template_flow_turn_completed",
        expect.objectContaining({
          inputTokens: null,
          outputTokens: null,
          totalTokens: null
        })
      )
    } finally {
      infoSpy.mockRestore()
    }
  })

  it("rejects the legacy generic-list shape before changing the draft", async () => {
    const aiProvider = createTestAiProvider([
      flowProviderResult({
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
    ])

    await expect(
      executeTemplateFlow(
        createInput(createBlankTemplateContent(), "Add a service list."),
        createDependencies({ aiProvider })
      )
    ).rejects.toMatchObject({
      statusCode: 502,
      message: "Flow returned changes that failed validation."
    })
  })

  it("rejects unreadable operation payload JSON before changing the draft", async () => {
    const aiProvider = createTestAiProvider([
      rawFlowProviderResult({
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
    ])

    await expect(
      executeTemplateFlow(
        createInput(createBlankTemplateContent(), "Rename the document."),
        createDependencies({ aiProvider })
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

function createInput(
  content: TemplateContent,
  instruction: string
): ExecuteTemplateFlowInput {
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

type TestTemplateFlowServiceDeps = Partial<TemplateFlowServiceDeps> & {
  aiProvider?: AiProvider
}

function createDependencies(
  overrides: TestTemplateFlowServiceDeps
): TemplateFlowServiceDeps {
  let idSequence = 100
  const {
    aiProvider = createTestAiProvider([
      flowProviderResult(successfulFlowPayload())
    ]),
    ...serviceOverrides
  } = overrides

  return {
    authorizeTemplateManagement: async (): Promise<void> => {},
    createId: (): string => {
      const suffix = String(idSequence).padStart(12, "0")
      idSequence += 1
      return `00000000-0000-4000-8000-${suffix}`
    },
    createTraceId: (): string => "local-flow-trace",
    getAiRuntime: () => ({
      provider: aiProvider,
      model: {
        provider: TEST_PROVIDER_ID,
        model: TEST_MODEL
      }
    }),
    loadHistory: async (): Promise<TemplateFlowMessage[]> => [],
    now: () => new Date("2026-07-23T17:30:00.000Z"),
    persistMessages: async (): Promise<void> => {},
    resolveAuthorName: async (): Promise<string> => "Alex Morgan",
    ...serviceOverrides
  }
}

type TestFlowOperation = {
  type: string
  summary: string
  payload: unknown
}

type TestFlowPayload = {
  assistantMessage: string
  needsConfirmation: boolean
  confirmationQuestion: string
  operations: TestFlowOperation[]
}

const testProviderRequests = new WeakMap<
  AiProvider,
  AiStructuredGenerationRequest[]
>()

function flowProviderResult(
  payload: TestFlowPayload
): AiStructuredGenerationResult {
  const providerPayload = {
    ...payload,
    operations: payload.operations.map(
      (operation: TestFlowOperation): Record<string, string> => ({
        type: operation.type,
        summary: operation.summary,
        payloadJson: JSON.stringify(operation.payload)
      })
    )
  }

  return rawFlowProviderResult(providerPayload)
}

function rawFlowProviderResult(
  payload: unknown
): AiStructuredGenerationResult {
  return {
    model: {
      provider: TEST_PROVIDER_ID,
      model: TEST_MODEL
    },
    text: JSON.stringify(payload),
    traceId: "provider-success-trace",
    upstreamCalls: 1,
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null
    }
  }
}

function successfulFlowPayload(): TestFlowPayload {
  return {
    assistantMessage: "I created the agreement.",
    needsConfirmation: false,
    confirmationQuestion: "",
    operations: []
  }
}

function createTestAiProvider(
  sequence: Array<AiStructuredGenerationResult | AiProviderError>
): AiProvider {
  const requests: AiStructuredGenerationRequest[] = []
  let responseIndex = 0
  const provider: AiProvider = {
    id: TEST_PROVIDER_ID,
    async generateStructured(
      request: AiStructuredGenerationRequest
    ): Promise<AiStructuredGenerationResult> {
      requests.push(request)
      const result =
        sequence[Math.min(responseIndex, Math.max(sequence.length - 1, 0))]
      responseIndex += 1

      if (result instanceof AiProviderError) {
        throw result
      }

      if (result === undefined) {
        throw new Error("The test AI provider has no configured result.")
      }

      return result
    }
  }

  testProviderRequests.set(provider, requests)
  return provider
}

function readProviderRequests(
  provider: AiProvider
): AiStructuredGenerationRequest[] {
  return testProviderRequests.get(provider) ?? []
}
