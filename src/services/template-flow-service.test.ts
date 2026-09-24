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
  type TemplateBlock,
  type TemplateContent
} from "@/types/template"
import type { TemplateFlowMessage } from "@/types/template-flow"

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
    expect(result.proposal).toBeNull()
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
      label: "Please specify",
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

  it("preserves the stable companion while repairing reorder and duplicates", async () => {
    const content = createDropdownContent(
      ["Billing", "Support", "Other"],
      true
    )
    const aiProvider = createTestAiProvider([
      flowProviderResult({
        assistantMessage: "I proposed reorganizing the category fields.",
        needsConfirmation: false,
        confirmationQuestion: "",
        operations: [
          createConditionalCompanionOperation(DROPDOWN_ID),
          {
            type: "move_block",
            summary: "Moved explanation field",
            payload: {
              blockId: COMPANION_ID,
              afterBlockId: null
            }
          }
        ]
      })
    ])

    const result = await executeTemplateFlow(
      createInput(content, "Keep the category fields together."),
      createDependencies({ aiProvider })
    )
    const blocks = result.proposal?.candidateDraft.content.blocks ?? []
    const companions = readOtherCompanions(blocks, DROPDOWN_ID)

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
      block.label === "Please specify" &&
      block.required &&
      block.visibleWhen?.sourceBlockId === dropdownId &&
      block.visibleWhen.operator === "equals" &&
      block.visibleWhen.value === "Other"
  )
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
