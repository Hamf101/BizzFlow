import { describe, expect, it, vi } from "vitest"

import type {
  AiModelReference,
  AiProvider,
  AiStructuredGenerationRequest,
  AiStructuredGenerationResult
} from "@/services/ai/contracts"
import {
  AI_PROVIDER_ERROR_CODES,
  AiProviderError
} from "@/services/ai/errors"
import { DocumentSigningServiceError } from "@/services/document-signing-service"
import {
  executeDocumentFlow,
  executeTemplateFlow,
  listTemplateFlowMessages,
  type ExecuteTemplateFlowInput,
  type TemplateFlowServiceDeps
} from "@/services/template-flow-service"
import {
  createBlankTemplateContent,
  templateContentV3Schema,
  type TemplateBlock,
  type TemplateContent,
  type TemplateContentV3
} from "@/types/template"
import type { TemplateFlowMessage } from "@/types/template-flow"
import { createLongDocumentContent } from "@/types/long-document.test-support"

const TEMPLATE_ID = "00000000-0000-4000-8000-000000000010"
const PARAGRAPH_ID = "00000000-0000-4000-8000-000000000011"
const DROPDOWN_ID = "00000000-0000-4000-8000-000000000012"
const COMPANION_ID = "00000000-0000-4000-8000-000000000013"
const FIELD_ID = "00000000-0000-4000-8000-000000000014"
const TEST_PROVIDER_ID = "test-provider"
const TEST_MODEL = "test-exact-model"

type TemplateFlowRow = Record<string, unknown>

class TemplateFlowQuery implements PromiseLike<{ data: unknown; error: null }> {
  private readonly filters: Array<[string, unknown]> = []

  constructor(private readonly rows: TemplateFlowRow[]) {}

  select(): TemplateFlowQuery {
    return this
  }

  eq(column: string, value: unknown): TemplateFlowQuery {
    this.filters.push([column, value])
    return this
  }

  async maybeSingle(): Promise<{ data: unknown; error: null }> {
    const matches = this.rows.filter((row) =>
      this.filters.every(([column, value]) => row[column] === value)
    )
    return { data: matches[0] ?? null, error: null }
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.maybeSingle().then(onfulfilled, onrejected)
  }
}

class TemplateFlowClient {
  constructor(readonly tables: Record<string, TemplateFlowRow[]>) {}

  from(tableName: string): TemplateFlowQuery {
    return new TemplateFlowQuery(this.tables[tableName] ?? [])
  }

  setMembershipPermissions(permissions: string[] | null): void {
    const membership = this.tables.organization_memberships?.[0]
    if (membership) {
      const roleDefinition = membership.role_definition as
        | { permissions: string[] | null }
        | undefined
      if (roleDefinition) {
        roleDefinition.permissions = permissions
      }
    }
  }
}

function createAuthorizationClient(
  permissions: string[] | null
): TemplateFlowClient {
  return new TemplateFlowClient({
    organization_memberships: [
      {
        org_id: "org-1",
        user_id: "user-1",
        role: "manager",
        status: "active",
        role_definition: { permissions }
      }
    ],
    document_templates: [
      { id: TEMPLATE_ID, org_id: "org-1", status: "draft" }
    ]
  })
}

describe("template Flow service", () => {
  it("allows a custom role with templates:manage to read Flow history", async () => {
    await expect(
      listTemplateFlowMessages(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          templateId: TEMPLATE_ID
        },
        {
          client: createAuthorizationClient(["templates:manage"]) as never,
          loadHistory: async (): Promise<TemplateFlowMessage[]> => []
        }
      )
    ).resolves.toEqual([])
  })

  it("rechecks edited Flow permissions and denies a revoked custom grant", async () => {
    const client = createAuthorizationClient(["templates:manage"])

    await expect(
      listTemplateFlowMessages(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          templateId: TEMPLATE_ID
        },
        {
          client: client as never,
          loadHistory: async (): Promise<TemplateFlowMessage[]> => []
        }
      )
    ).resolves.toEqual([])

    client.setMembershipPermissions([])

    await expect(
      listTemplateFlowMessages(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          templateId: TEMPLATE_ID
        },
        {
          client: client as never,
          loadHistory: async (): Promise<TemplateFlowMessage[]> => []
        }
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it("stages validated edits without mutating the base and persists a proposed receipt", async () => {
    const content = createContent()
    const originalContent = structuredClone(content)
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
              fieldStyle: "cell",
              logoAlignment: "right",
              logoWidthPercent: 32
            }
          }
        ]
      })
    ])
    const persistMessages = vi.fn(
      async (
        persistenceInput: Parameters<
          NonNullable<TemplateFlowServiceDeps["persistMessages"]>
        >[0]
      ): Promise<void> => {
        void persistenceInput
      }
    )
    const authorizeTemplateManagement = vi.fn(async (): Promise<void> => {})
    const history: TemplateFlowMessage[] = [
      {
        id: "00000000-0000-4000-8000-000000000099",
        role: "assistant",
        content: "What would you like to improve?",
        authorName: null,
        operations: [],
        changedBlockIds: [],
        receiptStatus: null,
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
    expect(content).toEqual(originalContent)
    expect(result.proposal).toMatchObject({
      status: "pending",
      operations: expect.any(Array),
      qualityIssues: expect.any(Array)
    })
    expect(result.proposal?.candidateDraft.content.blocks[0]).toMatchObject({
      id: PARAGRAPH_ID,
      text: "A concise introduction."
    })
    expect(result.proposal?.candidateDraft.content.branding.logoDataUrl).toBe(
      content.branding.logoDataUrl
    )
    expect(result.proposal?.candidateDraft.content.branding.accentColor).toBe("#635273")
    expect(result.proposal?.candidateDraft.content.branding.logoAlignment).toBe("right")
    expect(result.proposal?.candidateDraft.content.branding.logoWidthPercent).toBe(32)
    expect(result.proposal?.candidateDraft.content).toMatchObject({ layout: { fieldStyle: "cell" } })
    expect(result.proposal?.changedBlockIds).toEqual([PARAGRAPH_ID])
    expect(result.messages[1].operations).toHaveLength(2)
    expect(result.messages[1].receiptStatus).toBe("proposed")
    expect(result.messages[1].content).toContain("proposed")
    expect(result.messages[1].operations[0]?.target).toContain("Paragraph")
    expect(result.messages[1].operations[1]?.target).toBe("Document branding")
    expect(persistMessages).toHaveBeenCalledTimes(1)
    expect(persistMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalReceipt: expect.objectContaining({ status: "proposed" }),
        messages: expect.arrayContaining([
          expect.objectContaining({ receiptStatus: "proposed" })
        ])
      })
    )
    expect(persistMessages.mock.calls[0]?.[0]).not.toHaveProperty("proposal")
    expect(persistMessages.mock.calls[0]?.[0].proposalReceipt).not.toHaveProperty(
      "candidateDraft"
    )

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

  it("hands back a removal nobody asked for, and keeps the rest of the turn when the rewrite leaves the block alone", async () => {
    const removal: TestFlowOperation = { type: "remove_block", summary: "Removed introduction", payload: { blockId: PARAGRAPH_ID } }
    const rename: TestFlowOperation = { type: "set_title", summary: "Renamed it", payload: { value: "Short agreement" } }
    const { aiProvider, run } = runFlow(createContent(), [removal, rename], [rename])
    const result = await run

    expect(String(readProviderRequests(aiProvider)[1]?.input)).toMatch(/unrequested_removal.*A long introduction/)
    expect(result.needsConfirmation).toBe(false)
    expect(result.proposal?.candidateDraft).toMatchObject({ title: "Short agreement", content: { blocks: [{ id: PARAGRAPH_ID }] } })
  })

  it("asks before a removal the model insists on, naming what would go, and leaves the draft unchanged", async () => {
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
    expect(result.proposal).toBeNull()
    expect(result.messages[1].content).toContain("A long introduction")
    expect(result.messages[1].operations).toEqual([])
    expect(readProviderRequests(aiProvider)).toHaveLength(2)
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
      result.proposal?.candidateDraft.content.blocks
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

    expect(result.proposal?.candidateDraft.content.blocks).toEqual([
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
    expect(result.proposal?.candidateDraft.content.blocks).toEqual([])
    expect(result.proposal?.changedBlockIds).toEqual([PARAGRAPH_ID])
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
    expect(result.proposal).toBeNull()
    expect(result.messages[1].content).toContain("existing logo")
    expect(content.branding.logoDataUrl).toBe("data:image/png;base64,aGVsbG8=")
  })

  it("knows a stored logo is there without seeing its address, and removes it when asked", async () => {
    const content = createContent()
    content.branding.logoDataUrl = null
    content.branding.logoAsset = {
      height: 200,
      id: "00000000-0000-4000-8000-0000000000a1",
      type: "png",
      url: "https://r2.example.com/logo-display?signature=secret",
      width: 600
    }
    const aiProvider = createTestAiProvider([
      flowProviderResult({
        assistantMessage: "I removed the logo.",
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
      createInput(content, "Remove the logo."),
      createDependencies({ aiProvider })
    )

    const prompt = readProviderRequests(aiProvider)[0]?.input ?? ""
    expect(JSON.parse(prompt).currentDraft.branding.hasLogo).toBe(true)
    expect(prompt).not.toContain("r2.example.com")
    expect(result.proposal?.candidateDraft.content.branding.logoAsset).toBeNull()
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

  it("rejects a provider result model mismatch without fallback", async () => {
    const aiProvider = createTestAiProvider([
      rawFlowProviderResult(successfulFlowPayload(), {
        provider: "unexpected-provider",
        model: "unexpected-model"
      })
    ])

    await expect(
      executeTemplateFlow(
        createInput(createBlankTemplateContent(), "Create an agreement."),
        createDependencies({ aiProvider })
      )
    ).rejects.toMatchObject({
      statusCode: 502,
      message: "Flow returned a result from an unexpected provider or model."
    })
    expect(readProviderRequests(aiProvider)).toHaveLength(1)
  })

  it("uses exactly one repair for a semantic batch failure", async () => {
    const content = createContent()
    const originalContent = structuredClone(content)
    const aiProvider = createTestAiProvider([
      flowProviderResult({
        assistantMessage: "I proposed a revised title and introduction.",
        needsConfirmation: false,
        confirmationQuestion: "",
        operations: [
          {
            type: "set_title",
            summary: "Renamed document",
            payload: { value: "Partially changed title" }
          },
          {
            type: "update_block",
            summary: "Updated missing block",
            payload: {
              blockId: "00000000-0000-4000-8000-000000000099",
              block: {
                type: "paragraph",
                text: "Invalid partial edit.",
                alignment: "left"
              }
            }
          }
        ]
      }),
      flowProviderResult({
        assistantMessage: "I proposed a concise introduction.",
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
                text: "Valid repaired introduction.",
                alignment: "left"
              }
            }
          }
        ]
      })
    ])

    const result = await executeTemplateFlow(
      createInput(content, "Tighten the introduction."),
      createDependencies({ aiProvider })
    )

    expect(readProviderRequests(aiProvider)).toHaveLength(2)
    expect(readProviderRequests(aiProvider)[1]?.input).toContain(
      "semantic_validation"
    )
    expect(content).toEqual(originalContent)
    expect(result.proposal?.candidateDraft.title).toBe("Vendor agreement")
    expect(result.proposal?.candidateDraft.content.blocks[0]).toMatchObject({
      id: PARAGRAPH_ID,
      text: "Valid repaired introduction."
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

  it("recovers from a temporary provider outage with a proposal on the same model", async () => {
    const content = createContent()
    const original = structuredClone(content)
    const aiProvider = createTestAiProvider([
      temporaryProviderOutage(),
      flowProviderResult({
        ...successfulFlowPayload(),
        operations: [{ type: "set_title", summary: "Updated title", payload: { value: "Customer intake" } }],
      }),
    ])
    const persistMessages = vi.fn(async (): Promise<void> => {})
    const result = await executeTemplateFlow(
      createInput(content, "Rename this to Customer intake."),
      createDependencies({ aiProvider, persistMessages })
    )

    expect(result.proposal?.candidateDraft.title).toBe("Customer intake")
    expect(content).toEqual(original)
    expect(persistMessages).toHaveBeenCalledTimes(1)
    expect(readProviderRequests(aiProvider)).toHaveLength(2)
    expect(readProviderRequests(aiProvider)[1]).toEqual(readProviderRequests(aiProvider)[0])
  })

  it.each(["outage", "invalid output"])("stops after two calls when an outage is followed by %s", async (failure) => {
    const aiProvider = createTestAiProvider([
      temporaryProviderOutage(),
      failure === "outage"
        ? temporaryProviderOutage()
        : { ...flowProviderResult(successfulFlowPayload()), text: "not-json" },
    ])
    const persistMessages = vi.fn(async (): Promise<void> => {})

    await expect(executeTemplateFlow(
      createInput(createBlankTemplateContent(), "Create an agreement."),
      createDependencies({ aiProvider, persistMessages })
    )).rejects.toMatchObject({ statusCode: failure === "outage" ? 503 : 502 })
    expect(readProviderRequests(aiProvider)).toHaveLength(2)
    expect(persistMessages).not.toHaveBeenCalled()
  })

  it("does not retry an outage after spending the remaining call on semantic repair", async () => {
    const aiProvider = createTestAiProvider([
      { ...flowProviderResult(successfulFlowPayload()), text: "not-json" },
      temporaryProviderOutage(),
    ])

    await expect(executeTemplateFlow(
      createInput(createBlankTemplateContent(), "Create an agreement."),
      createDependencies({ aiProvider })
    )).rejects.toMatchObject({ statusCode: 503 })
    expect(readProviderRequests(aiProvider)).toHaveLength(2)
  })

  it("performs one bounded semantic repair on the same model", async () => {
    const aiProvider = createTestAiProvider([
      {
        ...flowProviderResult(successfulFlowPayload()),
        text: "not-json",
        traceId: "initial-invalid-trace",
        usage: {
          cachedTokens: 0,
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120
        }
      },
      {
        ...flowProviderResult(successfulFlowPayload()),
        traceId: "repair-success-trace",
        usage: {
          cachedTokens: 90,
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
      // The draft, the largest part, leads, and a repair repeats the first
      // prompt as its opening, so the provider can reuse what it already read.
      expect(Object.keys(JSON.parse(requests[0]?.input ?? "{}"))[0]).toBe("currentDraft")
      expect(requests[1]?.input.startsWith(requests[0]?.input.slice(0, -1) ?? "?")).toBe(true)
      expect(infoSpy).toHaveBeenCalledWith(
        "template_flow_turn_completed",
        expect.objectContaining({
          provider: TEST_PROVIDER_ID,
          model: TEST_MODEL,
          traceId: "repair-success-trace",
          upstreamCalls: 2,
          cachedTokens: 90,
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

  it("preserves existing field keys and deterministically deduplicates new labels", async () => {
    const content = createBlankTemplateContent()
    content.blocks = [
      {
        id: FIELD_ID,
        type: "text_field",
        fieldKey: "established_legal_name",
        label: "Legal name",
        required: true,
        helpText: null,
        placeholder: null,
        multiline: false
      }
    ]
    const aiProvider = createTestAiProvider([
      flowProviderResult({
        assistantMessage: "I proposed the requested contact fields.",
        needsConfirmation: false,
        confirmationQuestion: "",
        operations: [
          {
            type: "update_block",
            summary: "Renamed legal name field",
            payload: {
              blockId: FIELD_ID,
              block: {
                type: "text_field",
                fieldKey: "provider_must_not_replace_this",
                label: "Registered legal name",
                required: true,
                helpText: null,
                placeholder: null,
                multiline: false
              }
            }
          },
          createTextFieldOperation("Added primary contact", "Contact name"),
          createTextFieldOperation("Added secondary contact", "Contact name")
        ]
      })
    ])

    const result = await executeTemplateFlow(
      createInput(content, "Add two contact name fields."),
      createDependencies({ aiProvider })
    )
    const fieldBlocks = result.proposal?.candidateDraft.content.blocks.filter(
      (block: TemplateBlock): boolean => "fieldKey" in block
    )

    expect(fieldBlocks?.map((block: TemplateBlock) =>
      "fieldKey" in block ? block.fieldKey : ""
    )).toEqual([
      "established_legal_name",
      "contact_name",
      "contact_name_2"
    ])
  })

  it("adds one exact conditional companion for a new Other dropdown", async () => {
    const aiProvider = createTestAiProvider([
      flowProviderResult({
        assistantMessage: "I proposed a request category field.",
        needsConfirmation: false,
        confirmationQuestion: "",
        operations: [
          createDropdownOperation("Added request category", null, [
            "Billing",
            "Support",
            "Other"
          ])
        ]
      })
    ])

    const result = await executeTemplateFlow(
      createInput(createBlankTemplateContent(), "Add a request category."),
      createDependencies({ aiProvider })
    )
    const blocks = result.proposal?.candidateDraft.content.blocks ?? []
    const dropdown = blocks.find(
      (block: TemplateBlock): boolean => block.type === "dropdown_field"
    )
    const companions = readOtherCompanions(blocks, dropdown?.id ?? "")

    expect(dropdown?.type).toBe("dropdown_field")
    expect(companions).toHaveLength(1)
    expect(companions[0]).toMatchObject({
      label: "Other request category",
      required: true,
      visibleWhen: {
        sourceBlockId: dropdown?.id,
        operator: "equals",
        value: "Other"
      }
    })
    expect(blocks.map((block: TemplateBlock): string => block.id)).toEqual([
      dropdown?.id,
      companions[0]?.id
    ])
    expect(result.proposal?.operations[0]?.affectedBlockIds).toEqual([
      dropdown?.id,
      companions[0]?.id
    ])
  })

  it("adds the Other companion when an existing dropdown is updated", async () => {
    const content = createDropdownContent(["Billing", "Support"])
    const aiProvider = createTestAiProvider([
      flowProviderResult({
        assistantMessage: "I proposed an Other choice.",
        needsConfirmation: false,
        confirmationQuestion: "",
        operations: [
          createDropdownUpdateOperation(["Billing", "Support", "Other"])
        ]
      })
    ])

    const result = await executeTemplateFlow(
      createInput(content, "Add Other to the category list."),
      createDependencies({ aiProvider })
    )
    const blocks = result.proposal?.candidateDraft.content.blocks ?? []
    const companions = readOtherCompanions(blocks, DROPDOWN_ID)

    expect(companions).toHaveLength(1)
    expect(blocks.map((block: TemplateBlock): string => block.id)).toEqual([
      DROPDOWN_ID,
      companions[0]?.id
    ])
    expect(
      blocks.find(
        (block: TemplateBlock): boolean => block.id === DROPDOWN_ID
      )
    ).toMatchObject({ fieldKey: "request_category" })
  })

  it("restores an Other companion when operations arrive in reverse semantic order", async () => {
    const content = createDropdownContent(["Billing", "Support"])
    const aiProvider = createTestAiProvider([
      flowProviderResult({
        assistantMessage: "I proposed an Other choice and explanation field.",
        needsConfirmation: false,
        confirmationQuestion: "",
        operations: [
          createConditionalCompanionOperation(DROPDOWN_ID),
          createDropdownUpdateOperation(["Billing", "Support", "Other"])
        ]
      })
    ])

    const result = await executeTemplateFlow(
      createInput(content, "Add an Other option with an explanation."),
      createDependencies({ aiProvider })
    )
    const blocks = result.proposal?.candidateDraft.content.blocks ?? []
    const companions = readOtherCompanions(blocks, DROPDOWN_ID)

    expect(companions).toHaveLength(1)
    expect(companions[0]?.fieldKey).toBe("please_specify")
    expect(blocks.map((block: TemplateBlock): string => block.id)).toEqual([
      DROPDOWN_ID,
      companions[0]?.id
    ])
  })

  it("keeps the stable companion: a duplicate is dropped, and a move above its dropdown is refused with the reason", async () => {
    const content = createDropdownContent(
      ["Billing", "Support", "Other"],
      true
    )
    const reply = (operations: TestFlowOperation[]) =>
      flowProviderResult({ assistantMessage: "I proposed reorganizing the category fields.", needsConfirmation: false, confirmationQuestion: "", operations })
    const aiProvider = createTestAiProvider([
      reply([
        createConditionalCompanionOperation(DROPDOWN_ID),
        { type: "move_block", summary: "Moved explanation field", payload: { blockId: COMPANION_ID, afterBlockId: null } }
      ]),
      reply([createConditionalCompanionOperation(DROPDOWN_ID)])
    ])

    const result = await executeTemplateFlow(
      createInput(content, "Keep the category fields together."),
      createDependencies({ aiProvider })
    )
    const blocks = result.proposal?.candidateDraft.content.blocks ?? []
    const companions = readOtherCompanions(blocks, DROPDOWN_ID)

    expect(String(readProviderRequests(aiProvider)[1]?.input)).toMatch(/operations\[1\] move_block: .*conditional field/)

    expect(companions).toHaveLength(1)
    expect(companions[0]).toMatchObject({
      id: COMPANION_ID,
      fieldKey: "stable_specification",
      label: "Please specify",
      required: true
    })
    expect(blocks.map((block: TemplateBlock): string => block.id)).toEqual([
      DROPDOWN_ID,
      COMPANION_ID
    ])
  })

  it("attaches intentional Needs input findings without requesting a repair", async () => {
    const aiProvider = createTestAiProvider([
      flowProviderResult({
        assistantMessage: "I proposed a visible decision placeholder.",
        needsConfirmation: false,
        confirmationQuestion: "",
        operations: [
          {
            type: "add_block",
            summary: "Added unresolved rate decision",
            payload: {
              afterBlockId: null,
              block: {
                type: "paragraph",
                text: "Needs input: confirm the service rate.",
                alignment: "left"
              }
            }
          }
        ]
      })
    ])

    const result = await executeTemplateFlow(
      createInput(createBlankTemplateContent(), "Add the unresolved rate."),
      createDependencies({ aiProvider })
    )

    expect(readProviderRequests(aiProvider)).toHaveLength(1)
    expect(result.proposal?.qualityIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unresolved_needs_input" })
      ])
    )
  })

  it("returns no proposal when Flow only answers conversationally", async () => {
    const aiProvider = createTestAiProvider([
      flowProviderResult(successfulFlowPayload())
    ])

    const result = await executeTemplateFlow(
      createInput(createContent(), "Explain this document."),
      createDependencies({ aiProvider })
    )

    expect(result.proposal).toBeNull()
    expect(result.messages[1].receiptStatus).toBeNull()
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

describe("Flow and date formats", () => {
  it("keeps a date field's format when Flow rewrites the field without one", async () => {
    const content = createContent()
    content.blocks = [
      {
        dateFormat: { month: "number", order: "dmy", separator: "/" },
        fieldKey: "move_in",
        helpText: null,
        id: FIELD_ID,
        label: "Move-in date",
        required: false,
        type: "date_field",
      },
    ]
    const aiProvider = createTestAiProvider([
      flowProviderResult({
        assistantMessage: "The move-in date is now required.",
        needsConfirmation: false,
        confirmationQuestion: "",
        operations: [
          {
            type: "update_block",
            summary: "Required the move-in date",
            payload: {
              blockId: FIELD_ID,
              block: { type: "date_field", fieldKey: "move_in", label: "Move-in date", required: true, helpText: null },
            },
          },
        ],
      }),
    ])

    const result = await executeTemplateFlow(
      createInput(content, "Make the move-in date required."),
      createDependencies({ aiProvider })
    )

    expect(result.proposal?.candidateDraft.content.blocks[0]).toMatchObject({
      dateFormat: { month: "number", order: "dmy", separator: "/" },
      required: true,
    })
  })
})

describe("Flow checking its own draft", () => {
  const service = (options: string[], label = "Service needed"): TestFlowOperation[] => [
    { type: "add_block", summary: "Asked which service", payload: { afterBlockId: null, block: { type: "dropdown_field", fieldKey: "service", label, required: true, helpText: null, placeholder: null, options } } },
  ]
  const reply = (operations: TestFlowOperation[]) => flowProviderResult({ assistantMessage: "Done.", needsConfirmation: false, confirmationQuestion: "", operations })
  const placeholders = service(["Option 1", "Option 2"])
  const choices = (result: Awaited<ReturnType<typeof executeTemplateFlow>>) =>
    result.proposal?.candidateDraft.content.blocks.flatMap((block: TemplateBlock) => (block.type === "dropdown_field" ? block.options : []))

  it("rewrites once when its draft has a fault it can see, and proposes the better draft", async () => {
    const { aiProvider, run } = runFlow(createContent(), placeholders, service(["Deep clean", "Regular clean"]))
    const result = await run
    const requests = readProviderRequests(aiProvider)

    expect(requests).toHaveLength(2)
    expect((JSON.parse(String(requests[1]?.input)) as { revision: unknown }).revision).toMatchObject({
      faults: [{ blocks: [expect.stringContaining("Service needed")] }],
      priorResponse: expect.stringContaining("Option 1"),
    })
    expect(choices(result)).toEqual(["Deep clean", "Regular clean"])
    expect(result.proposal?.qualityIssues.map((issue) => issue.code)).not.toContain("dropdown_placeholder_choices")
  })

  it("keeps its first draft when the rewrite is no better, unreadable or never arrives", async () => {
    for (const second of [reply(service(["Choice 1", "Choice 2"])), { ...reply(placeholders), text: "not-json" }, temporaryProviderOutage()]) {
      const aiProvider = createTestAiProvider([reply(placeholders), second])
      const result = await executeTemplateFlow(createInput(createContent(), "Build the form."), createDependencies({ aiProvider }))

      expect(choices(result)).toEqual(["Option 1", "Option 2"])
      expect(readProviderRequests(aiProvider)).toHaveLength(2)
    }
  })

  it("spends no call on what it cannot fix, on faults that were already there, or when time is short", async () => {
    // A decision only the author can make, a health question, and no description.
    const open = runFlow(createContent(), [
      { type: "add_block", summary: "Left the fee open", payload: { afterBlockId: null, block: { type: "paragraph", text: "Needs input: the hourly fee.", alignment: "left" } } },
      { type: "add_block", summary: "Asked about medication", payload: { afterBlockId: null, block: { type: "text_field", fieldKey: "medications", label: "Current medications", required: false, helpText: null, placeholder: null, multiline: true } } },
    ])

    expect((await open.run).proposal?.qualityIssues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["unresolved_needs_input", "collects_health_information"])
    )
    expect(readProviderRequests(open.aiProvider)).toHaveLength(1)

    // The author's own placeholder choices, which this turn was not asked to touch.
    const content = createContent()
    content.blocks.push({ id: FIELD_ID, type: "dropdown_field", fieldKey: "plan", label: "Plan", required: false, helpText: null, placeholder: null, options: ["Option 1", "Option 2"] })
    const untouched = runFlow(content, [{ type: "set_title", summary: "Renamed it", payload: { value: "Cleaning intake" } }])

    await untouched.run
    expect(readProviderRequests(untouched.aiProvider)).toHaveLength(1)

    // A first answer that took so long a second would run past the request's time.
    const clock = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(101_000)
    const late = runFlow(createContent(), placeholders, service(["Deep clean", "Regular clean"]))

    expect(choices(await late.run)).toEqual(["Option 1", "Option 2"])
    expect(readProviderRequests(late.aiProvider)).toHaveLength(1)
    clock.mockRestore()
  })
})

describe("Flow reading a document longer than it can take in", () => {
  it("reads a 50-page document whole", async () => {
    const { aiProvider, run } = runFlow(createLongDocumentContent(), [])

    await run

    const { currentDraft } = JSON.parse(String(readProviderRequests(aiProvider)[0]?.input)) as {
      currentDraft: { blocks: unknown[]; omitted: { blocks: number }; pages: number }
    }

    expect(currentDraft.omitted.blocks).toBe(0)
    expect(currentDraft.pages).toBeGreaterThanOrEqual(50)
  })

  it("sends as many blocks as fit, and says how many it left out", async () => {
    const content = createContent()
    content.blocks = Array.from({ length: 1_200 }, (_, index) => ({
      id: `70000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      type: "paragraph" as const,
      text: `Clause ${index}: ${"the supplier keeps records for the period the client sets out. ".repeat(6)}`,
      alignment: "left" as const,
    }))
    const { aiProvider, run } = runFlow(content, [])

    await run

    const { currentDraft } = JSON.parse(String(readProviderRequests(aiProvider)[0]?.input)) as {
      currentDraft: { blocks: unknown[]; omitted: { blocks: number } }
    }
    const sent = JSON.stringify(currentDraft).length
    const oneMore = JSON.stringify(content.blocks[currentDraft.blocks.length]).length

    expect(currentDraft.blocks.length + currentDraft.omitted.blocks).toBe(1_200)
    expect(currentDraft.omitted.blocks).toBeGreaterThan(0)
    // Full to the limit and no further: the next block would not have fitted.
    expect(sent).toBeLessThan(400_010)
    expect(sent + oneMore).toBeGreaterThan(400_000)
  })
})

describe("Flow building with the blocks it adds", () => {
  it("lets one turn say where its new blocks go and what shows them, by whatever names it gave them", async () => {
    const { run } = runFlow(createContent(), [
      { type: "add_block", summary: "Asked about pets", payload: { ref: "new:has_pet", afterBlockId: null, block: { type: "checkbox_field", fieldKey: "pet", label: "Has a pet", required: false, helpText: null, checkedByDefault: false } } },
      {
        type: "add_block",
        summary: "Asked the pet's name",
        payload: { afterBlockId: "new:has_pet", block: { type: "text_field", fieldKey: "name", label: "Pet's name", required: false, helpText: null, placeholder: null, multiline: false, visibleWhen: { sourceBlockId: "new:has_pet", operator: "equals", value: true } } },
      },
      { type: "add_block", summary: "Asked the kind of pet", payload: { ref: "b_kind", afterBlockId: null, block: { type: "dropdown_field", fieldKey: "kind", label: "Kind of pet", required: false, helpText: null, placeholder: null, options: ["Dog", "Cat", "Other"], otherLabel: "What kind of pet is it?" } } },
      { type: "add_block", summary: "Thanked them", payload: { afterBlockId: "b_kind", block: { type: "paragraph", text: "Thank you.", alignment: "left" } } },
    ])
    const blocks = (await run).proposal!.candidateDraft.content.blocks
    const named = (label: string) => blocks.find((block: TemplateBlock) => "label" in block && block.label === label)!

    expect(blocks.map((block: TemplateBlock) => ("label" in block ? block.label : block.type))).toEqual([
      "paragraph",
      "Has a pet",
      "Pet's name",
      "Kind of pet",
      // Added after the new dropdown, the paragraph still leaves its "Other" answer beside it,
      // asked as the question Flow wrote for it.
      "What kind of pet is it?",
      "paragraph",
    ])
    expect(named("Pet's name")).toMatchObject({ visibleWhen: { sourceBlockId: named("Has a pet").id, value: true } })
    expect(named("What kind of pet is it?")).toMatchObject({ visibleWhen: { sourceBlockId: named("Kind of pet").id } })
  })

  it("keeps every section and row on the blocks it named when an \"Other\" answer is slotted in above them", async () => {
    const field = (label: string) => ({ type: "text_field", fieldKey: "key", label, required: false, helpText: null, placeholder: null, multiline: false })
    const add = (ref: string, afterBlockId: string | null, block: Record<string, unknown>): TestFlowOperation => ({ type: "add_block", summary: `Added ${String(block.label)}`, payload: { ref, afterBlockId, block } })
    const { run } = runFlow(createContent(), [
      add("kind", PARAGRAPH_ID, { type: "dropdown_field", fieldKey: "kind", label: "Property type", required: false, helpText: null, placeholder: null, options: ["House", "Flat", "Other"] }),
      // Written after the dropdown, as a model writes them: the "Other" answer has to go in between.
      add("bedrooms", "kind", field("Bedrooms")),
      add("bathrooms", "bedrooms", field("Bathrooms")),
      add("access", "bathrooms", field("Access instructions")),
      add("signature", "access", { type: "signature_field", fieldKey: "signature", label: "Signature", required: true, helpText: null }),
      add("signed", "signature", { type: "date_field", fieldKey: "signed", label: "Date signed", required: true, helpText: null }),
      { type: "set_row", summary: "Set the rooms side by side", payload: { blockIds: ["bedrooms", "bathrooms"] } },
      { type: "set_section", summary: "Started the access section", payload: { blockId: "access", label: "Access" } },
      { type: "set_row", summary: "Set signature and date side by side", payload: { blockIds: ["signature", "signed"] } },
    ])
    const { blocks, fieldGroups, sections } = (await run).proposal!.candidateDraft.content as TemplateContentV3
    const label = (blockId: string) => blocks.flatMap((block: TemplateBlock) => (block.id === blockId && "label" in block ? [block.label] : []))[0]

    expect(blocks.flatMap((block: TemplateBlock) => ("label" in block ? [block.label] : []))).toEqual([
      // No question written for it: named after its dropdown.
      "Property type", "Other property type", "Bedrooms", "Bathrooms", "Access instructions", "Signature", "Date signed",
    ])
    expect(fieldGroups.map((row) => [label(row.startBlockId), label(row.endBlockId)])).toEqual([
      ["Bedrooms", "Bathrooms"],
      ["Signature", "Date signed"],
    ])
    expect(sections.filter((section) => section.label === "Access").map((section) => label(section.startBlockId))).toEqual(["Access instructions"])
  })

  it("keeps the formatting of words it leaves alone, and the height a box was given", async () => {
    const content = createContent()
    content.blocks = [
      { id: PARAGRAPH_ID, type: "heading", level: 2, alignment: "left", text: "Rental terms", runs: [{ text: "Rental " }, { text: "terms", bold: true }] },
      { id: FIELD_ID, type: "text_field", fieldKey: "notes", label: "Notes", required: false, helpText: null, placeholder: null, multiline: true, boxHeight: 90 },
    ]
    const { run } = runFlow(content, [
      { type: "update_block", summary: "Made it the main heading", payload: { blockId: PARAGRAPH_ID, block: { type: "heading", level: 1, alignment: "left", text: "Rental terms" } } },
      { type: "update_block", summary: "Reworded the label", payload: { blockId: FIELD_ID, block: { type: "text_field", fieldKey: "notes", label: "Notes for the landlord", required: false, helpText: null, placeholder: null, multiline: true } } },
    ])

    expect((await run).proposal?.candidateDraft.content.blocks).toMatchObject([
      { level: 1, runs: [{ text: "Rental " }, { text: "terms", bold: true }] },
      { label: "Notes for the landlord", boxHeight: 90 },
    ])
  })

  it("tells the model which operation failed and why, so its one correction lands", async () => {
    const add = { type: "add_block", summary: "Added a note", payload: { ref: "new:1", afterBlockId: null, block: { type: "paragraph", text: "A note.", alignment: "left" } } }
    const { aiProvider, run } = runFlow(createContent(), [add, { type: "move_block", summary: "Moved it up", payload: { blockId: "new:2", afterBlockId: null } }], [add])
    const result = await run

    expect(String(readProviderRequests(aiProvider)[1]?.input)).toMatch(/operations\[1\] move_block: .*new:2/)
    expect(result.proposal?.candidateDraft.content.blocks).toHaveLength(2)
    expect(readProviderRequests(aiProvider)).toHaveLength(2)
  })

  it("refuses, and says why, what it would otherwise drop or mistake, and survives a payload nested without end", async () => {
    const checkbox = { id: FIELD_ID, type: "checkbox_field" as const, fieldKey: "pet", label: "Has a pet", required: false, helpText: null, checkedByDefault: false }
    const paragraph = { type: "paragraph", text: "A note.", alignment: "left" }
    const refused: Array<[RegExp, TestFlowOperation[]]> = [
      // A name given to two new blocks.
      [/operations\[1\] add_block: .*new:1/, [1, 2].map(() => ({ type: "add_block", summary: "Added a note", payload: { ref: "new:1", afterBlockId: null, block: paragraph } }))],
      // A name that is an existing block's id, which would turn every later mention of that block to the new one.
      [/operations\[0\] add_block: ref .*short name/, [{ type: "add_block", summary: "Added a note", payload: { ref: PARAGRAPH_ID, afterBlockId: null, block: paragraph } }]],
      // A condition on a field that comes later: once dropped without a word.
      [
        /operations\[0\] add_block: .*visibleWhen/,
        [{ type: "add_block", summary: "Asked the pet's name", payload: { afterBlockId: PARAGRAPH_ID, block: { type: "text_field", fieldKey: "name", label: "Pet's name", required: false, helpText: null, placeholder: null, multiline: false, visibleWhen: { sourceBlockId: FIELD_ID, operator: "equals", value: true } } } }],
      ],
      // A move that puts a field's source after it: the field would show for everyone.
      [/operations\[0\] move_block: .*conditional field/, [{ type: "move_block", summary: "Moved the question down", payload: { blockId: FIELD_ID, afterBlockId: COMPANION_ID } }]],
    ]

    for (const [reason, operations] of refused) {
      const content = createContent()
      content.blocks.push(checkbox, { id: COMPANION_ID, type: "text_field", fieldKey: "age", label: "Pet's age", required: false, helpText: null, placeholder: null, multiline: false, visibleWhen: { sourceBlockId: FIELD_ID, operator: "equals", value: true } })
      const { aiProvider, run } = runFlow(content, operations)

      await expect(run).rejects.toMatchObject({ statusCode: 502 })
      expect(String(readProviderRequests(aiProvider)[1]?.input)).toMatch(reason)
    }

    const nested = rawFlowProviderResult({
      assistantMessage: "Done.",
      needsConfirmation: false,
      confirmationQuestion: "",
      operations: [{ type: "move_block", summary: "Moved it", payloadJson: `${'{"a":'.repeat(7_000)}1${"}".repeat(7_000)}` }],
    })

    await expect(
      executeTemplateFlow(createInput(createContent(), "Build the form."), createDependencies({ aiProvider: createTestAiProvider([nested]) }))
    ).rejects.toMatchObject({ statusCode: 502 })
  })
})

describe("Flow laying out a document", () => {
  const field = (label: string, more: Record<string, unknown> = {}) => ({ type: "text_field", fieldKey: "key", label, required: false, helpText: null, placeholder: null, multiline: false, ...more })
  const add = (ref: string, afterBlockId: string | null, block: Record<string, unknown>): TestFlowOperation => ({ type: "add_block", summary: `Added ${String(block.label)}`, payload: { ref, afterBlockId, block } })

  it("builds a section, a row, a tall box and a closing signature set to one side, all in one turn", async () => {
    const { run } = runFlow(createContent(), [
      add("new:1", null, field("Full name")),
      add("new:2", "new:1", field("Phone")),
      add("new:3", "new:2", field("Notes", { multiline: true, boxHeight: 120 })),
      add("new:4", "new:3", { type: "signature_field", fieldKey: "key", label: "Signature", required: true, helpText: null }),
      { type: "set_section", summary: "Started the contact section", payload: { blockId: "new:1", label: "Contact details", keepTogether: true } },
      { type: "set_row", summary: "Set name and phone side by side", payload: { blockIds: ["new:1", "new:2"], widths: [8, 4] } },
      { type: "set_block_rule", summary: "Started notes on a new page", payload: { blockId: "new:3", pageBreakBefore: true } },
      { type: "set_block_rule", summary: "Set the signature to the right", payload: { blockId: "new:4", spaceAbove: 24, frame: { left: 50, width: 50 } } },
    ])
    const proposal = (await run).proposal!
    const content = templateContentV3Schema.parse(proposal.candidateDraft.content)
    const id = (label: string) => content.blocks.find((block) => "label" in block && block.label === label)!.id

    expect(content.sections).toMatchObject([{ keepTogether: true, label: "Contact details", pageBreakBefore: false, startBlockId: id("Full name") }])
    expect(content.fieldGroups).toMatchObject([{ columns: 2, endBlockId: id("Phone"), startBlockId: id("Full name"), widths: [8, 4] }])
    expect(content.blockRules).toEqual([
      { blockId: id("Notes"), keepWithNext: false, pageBreakBefore: true },
      { blockId: id("Signature"), frame: { left: 50, width: 50 }, keepWithNext: false, pageBreakBefore: false, spaceAbove: 24 },
    ])
    expect(content.blocks.find((block) => block.id === id("Notes"))).toMatchObject({ boxHeight: 120 })
    // The row's two blocks are both marked as changed, for the page to show.
    expect(proposal.operations.find((operation) => operation.type === "set_row")?.affectedBlockIds).toEqual([id("Full name"), id("Phone")])
  })

  it("makes a row of part of a wider one where it stands, takes a row apart, and ends a section, moving nothing else", async () => {
    const { run: built } = runFlow(createContent(), [
      add("new:1", null, field("Full name")),
      add("new:2", "new:1", field("Phone")),
      add("new:3", "new:2", field("Email")),
      { type: "set_section", summary: "Started the contact section", payload: { blockId: "new:1", label: "Contact details" } },
      { type: "set_row", summary: "Set three side by side", payload: { blockIds: ["new:1", "new:2", "new:3"] } },
    ])
    const start = (await built).proposal!.candidateDraft.content as TemplateContentV3
    const [, name, phone, email] = start.blocks.map((block) => block.id)
    const order = start.blocks.map((block) => block.id)
    const { run } = runFlow(start, [
      // Email, not named, steps out of the row; the two named stay where they are.
      { type: "set_row", summary: "Left name and phone side by side, the name wider", payload: { blockIds: [name, phone], widths: [9, 3] } },
      { type: "set_section", summary: "Ended the section", payload: { blockId: name, label: null } },
      { type: "set_block_rule", summary: "Kept the email with what follows", payload: { blockId: email, frame: null, keepWithNext: true } },
    ])
    const content = (await run).proposal!.candidateDraft.content as TemplateContentV3

    // The same row, narrowed and resized in place: its id is the one it had.
    expect(content.fieldGroups).toMatchObject([{ columns: 2, endBlockId: phone, id: start.fieldGroups[0]!.id, startBlockId: name, widths: [9, 3] }])
    expect(content.sections).toEqual([])
    expect(content.blockRules).toEqual([{ blockId: email, keepWithNext: true, pageBreakBefore: false }])
    expect(content.blocks.map((block) => block.id)).toEqual(order)

    const { run: apart } = runFlow(content, [{ type: "stand_alone", summary: "Put the phone on its own line", payload: { blockId: phone } }])
    const alone = (await apart).proposal!.candidateDraft.content as TemplateContentV3

    expect(alone.fieldGroups).toEqual([])
    expect(alone.blocks.map((block) => block.id)).toEqual(order)
  })

  it("holds what it is given within the page, and refuses by name what cannot be laid out", async () => {
    const { run: built } = runFlow(createContent(), [
      add("new:1", null, field("Full name")),
      add("new:2", "new:1", field("Phone")),
      add("new:3", "new:2", field("Email")),
      { type: "set_row", summary: "Set two side by side", payload: { blockIds: ["new:1", "new:2"] } },
    ])
    const start = (await built).proposal!.candidateDraft.content as TemplateContentV3
    const [paragraph, name, phone, email] = start.blocks.map((block) => block.id)
    const { run } = runFlow(start, [{ type: "set_block_rule", summary: "Pushed it far down and off the edge", payload: { blockId: email, spaceAbove: 9_999, frame: { left: 90, width: 50 } } }])

    expect(((await run).proposal!.candidateDraft.content as TemplateContentV3).blockRules).toEqual([
      { blockId: email, frame: { left: 90, width: 10 }, keepWithNext: false, pageBreakBefore: false, spaceAbove: 600 },
    ])

    const refused: Array<[RegExp, TestFlowOperation]> = [
      [/set_block_rule: .*row/, { type: "set_block_rule", summary: "Framed a row member", payload: { blockId: name, frame: { left: 50, width: 50 } } }],
      [/set_block_rule: /, { type: "set_block_rule", summary: "Changed nothing", payload: { blockId: email } }],
      [/set_row: .*12/, { type: "set_row", summary: "Widths that do not fill the row", payload: { blockIds: [name, phone], widths: [8, 8] } }],
      [/set_row: .*12/, { type: "set_row", summary: "A width for a block not there", payload: { blockIds: [name, phone], widths: [4, 4, 4] } }],
      [/blockIds/, { type: "set_row", summary: "Five in a row", payload: { blockIds: [paragraph, name, phone, email, email] } }],
      [/set_row: .*different/, { type: "set_row", summary: "The same block twice", payload: { blockIds: [email, email] } }],
      [/stand_alone: .*row/, { type: "stand_alone", summary: "Took out a block in no row", payload: { blockId: email } }],
      [/set_section: /, { type: "set_section", summary: "Ended a section that is not there", payload: { blockId: email, label: null } }],
      [/set_section: /, { type: "set_section", summary: "Started one at a missing block", payload: { blockId: TEMPLATE_ID, label: "Extras" } }],
    ]

    for (const [reason, operation] of refused) {
      const { aiProvider, run: attempt } = runFlow(start, [operation])

      await expect(attempt, operation.summary).rejects.toMatchObject({ statusCode: 502 })
      expect(String(readProviderRequests(aiProvider)[1]?.input), operation.summary).toMatch(reason)
    }
  })
})

describe("document Flow", () => {
  const DOCUMENT_ID = "00000000-0000-4000-8000-000000000020"

  function documentInput(instruction: string): Parameters<typeof executeDocumentFlow>[0] {
    return {
      actorUserId: "user-1",
      documentId: DOCUMENT_ID,
      draft: { title: "Lease, Flat 3B", description: "", content: createContent() },
      instruction,
      organizationId: "org-1"
    }
  }

  it("proposes changes to the document's own page and keeps the turn out of template history", async () => {
    const aiProvider = createTestAiProvider([
      flowProviderResult({
        assistantMessage: "I tightened the introduction.",
        needsConfirmation: false,
        confirmationQuestion: "",
        operations: [
          {
            type: "update_block",
            summary: "Condensed introduction",
            payload: {
              blockId: PARAGRAPH_ID,
              block: { type: "paragraph", text: "A concise introduction.", alignment: "left" }
            }
          }
        ]
      })
    ])
    const authorizeDocument = vi.fn(async (): Promise<void> => {})
    const loadHistory = vi.fn(async (): Promise<TemplateFlowMessage[]> => [])
    const persistMessages = vi.fn(async (): Promise<void> => {})

    const result = await executeDocumentFlow(
      documentInput("Make the introduction more concise."),
      { ...createDependencies({ aiProvider, loadHistory, persistMessages }), authorizeDocument }
    )

    expect(authorizeDocument).toHaveBeenCalledWith({
      actorUserId: "user-1",
      documentId: DOCUMENT_ID,
      organizationId: "org-1"
    })
    expect(result.proposal?.candidateDraft.title).toBe("Lease, Flat 3B")
    expect(result.proposal?.candidateDraft.content.blocks).toContainEqual(
      expect.objectContaining({ id: PARAGRAPH_ID, text: "A concise introduction." })
    )
    // A document is not a template: its turns never reach a template's shared history.
    expect(loadHistory).not.toHaveBeenCalled()
    expect(persistMessages).not.toHaveBeenCalled()
  })

  it("tells someone who cannot open the document nothing, before any provider is asked", async () => {
    const aiProvider = createTestAiProvider([flowProviderResult(successfulFlowPayload())])

    await expect(
      executeDocumentFlow(documentInput("Summarise this."), {
        ...createDependencies({ aiProvider }),
        authorizeDocument: async (): Promise<void> => {
          throw new DocumentSigningServiceError("Generated document was not found.", 404)
        }
      })
    ).rejects.toMatchObject({ message: "Generated document was not found.", statusCode: 404 })
    await expect(
      executeDocumentFlow(
        { ...documentInput("Summarise this."), documentId: "not-a-document" },
        createDependencies({ aiProvider })
      )
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(readProviderRequests(aiProvider)).toHaveLength(0)
  })
})

function createTextFieldOperation(
  summary: string,
  label: string
): TestFlowOperation {
  return {
    type: "add_block",
    summary,
    payload: {
      afterBlockId: null,
      block: {
        type: "text_field",
        fieldKey: "provider_supplied_key",
        label,
        required: false,
        helpText: null,
        placeholder: null,
        multiline: false
      }
    }
  }
}

function createDropdownOperation(
  summary: string,
  afterBlockId: string | null,
  options: string[]
): TestFlowOperation {
  return {
    type: "add_block",
    summary,
    payload: {
      afterBlockId,
      block: {
        type: "dropdown_field",
        fieldKey: "provider_supplied_key",
        label: "Request category",
        required: true,
        helpText: null,
        placeholder: null,
        options
      }
    }
  }
}

function createDropdownUpdateOperation(options: string[]): TestFlowOperation {
  return {
    type: "update_block",
    summary: "Updated request category choices",
    payload: {
      blockId: DROPDOWN_ID,
      block: {
        type: "dropdown_field",
        fieldKey: "provider_must_not_replace_this",
        label: "Request category",
        required: true,
        helpText: null,
        placeholder: null,
        options
      }
    }
  }
}

function createConditionalCompanionOperation(
  dropdownId: string
): TestFlowOperation {
  return {
    type: "add_block",
    summary: "Added category explanation",
    payload: {
      afterBlockId: dropdownId,
      block: {
        type: "text_field",
        fieldKey: "provider_supplied_key",
        label: "Please specify",
        required: true,
        helpText: null,
        placeholder: null,
        multiline: false,
        visibleWhen: {
          sourceBlockId: dropdownId,
          operator: "equals",
          value: "Other"
        }
      }
    }
  }
}

function createDropdownContent(
  options: string[],
  includeCompanion = false
): TemplateContent {
  const content = createBlankTemplateContent()
  content.blocks = [
    {
      id: DROPDOWN_ID,
      type: "dropdown_field",
      fieldKey: "request_category",
      label: "Request category",
      required: true,
      helpText: null,
      placeholder: null,
      options
    }
  ]

  if (includeCompanion) {
    content.blocks.push({
      id: COMPANION_ID,
      type: "text_field",
      fieldKey: "stable_specification",
      label: "Please specify",
      required: true,
      helpText: null,
      placeholder: null,
      multiline: false,
      visibleWhen: {
        sourceBlockId: DROPDOWN_ID,
        operator: "equals",
        value: "Other"
      }
    })
  }

  return content
}

function readOtherCompanions(
  blocks: TemplateBlock[],
  dropdownId: string
): Array<Extract<TemplateBlock, { type: "text_field" }>> {
  return blocks.filter(
    (
      block: TemplateBlock
    ): block is Extract<TemplateBlock, { type: "text_field" }> =>
      block.type === "text_field" &&
      block.required &&
      block.visibleWhen?.sourceBlockId === dropdownId &&
      block.visibleWhen.operator === "equals" &&
      block.visibleWhen.value === "Other"
  )
}

// One Flow turn over a document: what the model replies with first, and after a correction.
function runFlow(content: TemplateContent, ...replies: TestFlowOperation[][]) {
  const aiProvider = createTestAiProvider(
    replies.map((operations: TestFlowOperation[]) => flowProviderResult({ assistantMessage: "Done.", needsConfirmation: false, confirmationQuestion: "", operations }))
  )

  return { aiProvider, run: executeTemplateFlow(createInput(content, "Build the form."), createDependencies({ aiProvider })) }
}

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
  payload: unknown,
  model: AiModelReference = {
    provider: TEST_PROVIDER_ID,
    model: TEST_MODEL
  }
): AiStructuredGenerationResult {
  return {
    model,
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

function temporaryProviderOutage(): AiProviderError {
  return new AiProviderError({
    code: AI_PROVIDER_ERROR_CODES.UPSTREAM_UNAVAILABLE,
    message: "Provider temporarily unavailable.",
    model: { provider: TEST_PROVIDER_ID, model: TEST_MODEL },
    provider: TEST_PROVIDER_ID,
    retryable: true,
    statusCode: 503,
    traceId: "provider-outage-trace",
  })
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
