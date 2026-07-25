import { randomUUID } from "node:crypto"

import { z } from "zod"

import { getGeminiEnv, type GeminiEnv } from "@/lib/env"
import {
  createAdminClient,
  type AdminSupabaseClient
} from "@/lib/supabase/admin"
import {
  createGeminiTemplateFlowSchema,
  TEMPLATE_FLOW_OPERATION_TYPES
} from "@/services/template-ai/gemini-flow-schema"
import {
  bulletListBlockSchema,
  checkboxFieldBlockSchema,
  dateFieldBlockSchema,
  dividerBlockSchema,
  dropdownFieldBlockSchema,
  fileFieldBlockSchema,
  headingBlockSchema,
  initialsFieldBlockSchema,
  numberedListBlockSchema,
  paragraphBlockSchema,
  signatureFieldBlockSchema,
  tableBlockSchema,
  templateBlockSchema,
  templateContentSchema,
  textFieldBlockSchema,
  type TemplateBlock,
  type TemplateContent
} from "@/types/template"
import type {
  TemplateFlowDraft,
  TemplateFlowLedgerItem,
  TemplateFlowMessage,
  TemplateFlowMessageRow,
  TemplateFlowOperationType,
  TemplateFlowResult
} from "@/types/template-flow"

const GEMINI_INTERACTIONS_API_URL =
  "https://generativelanguage.googleapis.com/v1/interactions"
const GEMINI_MAX_OUTPUT_TOKENS = 8_192
const GEMINI_MAX_REQUEST_ATTEMPTS = 3
const GEMINI_RETRY_BASE_DELAY_MS = 500
const GEMINI_FALLBACK_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview"
] as const
const MAX_FLOW_HISTORY_MESSAGES = 20
const MAX_FLOW_CONTEXT_CHARACTERS = 55_000

const uuidSchema = z.string().uuid()
const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/)
const flowDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().max(2_000),
    content: templateContentSchema
  })
  .strict()
const flowRequestSchema = z
  .object({
    actorUserId: z.string().trim().min(1),
    organizationId: z.string().trim().min(1),
    templateId: z.string().uuid(),
    draft: flowDraftSchema,
    instruction: z.string().trim().min(2).max(2_000)
  })
  .strict()
const generatedBlockSchema = z.discriminatedUnion("type", [
  headingBlockSchema.omit({ id: true }),
  paragraphBlockSchema.omit({ id: true }),
  bulletListBlockSchema.omit({ id: true }),
  numberedListBlockSchema.omit({ id: true }),
  tableBlockSchema.omit({ id: true }),
  dividerBlockSchema.omit({ id: true }),
  textFieldBlockSchema.omit({ id: true }),
  dateFieldBlockSchema.omit({ id: true }),
  checkboxFieldBlockSchema.omit({ id: true }),
  dropdownFieldBlockSchema.omit({ id: true }),
  initialsFieldBlockSchema.omit({ id: true }),
  signatureFieldBlockSchema.omit({ id: true }),
  fileFieldBlockSchema.omit({ id: true })
])
const operationSummarySchema = z.string().trim().min(1).max(180)
const flowWireOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("set_title"),
      summary: operationSummarySchema,
      payload: z.object({ value: z.string().trim().min(1).max(180) }).strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("set_description"),
      summary: operationSummarySchema,
      payload: z.object({ value: z.string().trim().max(2_000) }).strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("set_branding"),
      summary: operationSummarySchema,
      payload: z
        .object({
          organizationName: z.string().trim().max(160).optional(),
          primaryColor: hexColorSchema.optional(),
          accentColor: hexColorSchema.optional(),
          logoAlignment: z.enum(["left", "center", "right"]).optional(),
          logoWidthPercent: z.number().int().min(10).max(60).optional(),
          removeLogo: z.boolean().optional()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("add_block"),
      summary: operationSummarySchema,
      payload: z
        .object({
          afterBlockId: uuidSchema.nullable(),
          block: generatedBlockSchema
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("update_block"),
      summary: operationSummarySchema,
      payload: z
        .object({
          blockId: uuidSchema,
          block: generatedBlockSchema
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("update_image"),
      summary: operationSummarySchema,
      payload: z
        .object({
          blockId: uuidSchema,
          altText: z.string().trim().min(1).max(500),
          caption: z.string().trim().max(500).nullable(),
          alignment: z.enum(["left", "center", "right"]),
          widthPercent: z.number().int().min(10).max(100)
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("move_block"),
      summary: operationSummarySchema,
      payload: z
        .object({
          blockId: uuidSchema,
          afterBlockId: uuidSchema.nullable()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("remove_block"),
      summary: operationSummarySchema,
      payload: z.object({ blockId: uuidSchema }).strict()
    })
    .strict()
])
const flowProviderResponseSchema = z
  .object({
    assistantMessage: z.string().trim().min(1).max(2_000),
    needsConfirmation: z.boolean(),
    confirmationQuestion: z.string().trim().max(500),
    operations: z.array(flowWireOperationSchema).max(24)
  })
  .strict()
const geminiFlowProviderResponseSchema = z
  .object({
    assistantMessage: z.string().trim().min(1).max(2_000),
    needsConfirmation: z.boolean(),
    confirmationQuestion: z.string().trim().max(500),
    operations: z
      .array(
        z
          .object({
            type: z.enum(TEMPLATE_FLOW_OPERATION_TYPES),
            summary: operationSummarySchema,
            payloadJson: z.string().trim().min(2).max(50_000)
          })
          .strict()
      )
      .max(24)
  })
  .strict()

type FlowProviderResponse = z.infer<typeof flowProviderResponseSchema>
type FlowProviderResult = {
  model: string
  response: FlowProviderResponse
}
type FlowWireOperation = z.infer<typeof flowWireOperationSchema>
type GeneratedBlock = z.infer<typeof generatedBlockSchema>
type FlowOperationPayload<T extends TemplateFlowOperationType> = Extract<
  FlowWireOperation,
  { type: T }
>["payload"]
type TemplateFlowClient = Pick<AdminSupabaseClient, "from">

type GeminiInteractionResponse = {
  status?: string
  steps?: Array<{
    type?: string
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
}

export type ExecuteTemplateFlowInput = {
  actorUserId: string
  organizationId: string
  templateId: unknown
  draft: unknown
  instruction: unknown
}

export type ListTemplateFlowMessagesInput = {
  actorUserId: string
  organizationId: string
  templateId: string
}

export type TemplateFlowServiceDeps = {
  authorizeTemplateManagement?: (input: {
    actorUserId: string
    organizationId: string
    templateId: string
  }) => Promise<void>
  createId?: () => string
  delayImpl?: (durationMs: number, signal: AbortSignal) => Promise<void>
  fetchImpl?: typeof fetch
  getConfig?: () => GeminiEnv
  loadHistory?: (input: {
    organizationId: string
    templateId: string
  }) => Promise<TemplateFlowMessage[]>
  now?: () => Date
  persistMessages?: (input: {
    messages: [TemplateFlowMessage, TemplateFlowMessage]
    organizationId: string
    templateId: string
    actorUserId: string
  }) => Promise<void>
  resolveAuthorName?: (actorUserId: string) => Promise<string>
}

/** Error raised when Flow cannot safely complete a template conversation turn. */
export class TemplateFlowServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates a user-safe Flow service error.
   *
   * @param message - Message suitable for an API response.
   * @param statusCode - HTTP-style status used by the route layer.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "TemplateFlowServiceError"
    this.statusCode = statusCode
  }
}

/**
 * Executes one stateless, template-aware Flow conversation turn.
 *
 * Flow receives the current unsaved draft plus bounded application-owned chat
 * history. Provider output is treated as untrusted: every typed operation is
 * validated, applied to a clone, and checked against the canonical template
 * schema before it reaches the browser.
 *
 * @param input - Authenticated actor, template, draft, and conversational request.
 * @param deps - Optional authorization, persistence, provider, and clock adapters.
 * @returns The canonical next draft and two attributed conversation messages.
 * @throws TemplateFlowServiceError for invalid, unauthorized, or provider failures.
 */
export async function executeTemplateFlow(
  input: ExecuteTemplateFlowInput,
  deps: TemplateFlowServiceDeps = {}
): Promise<TemplateFlowResult> {
  const startedAt = performance.now()
  const parsedInput = flowRequestSchema.safeParse(input)

  if (!parsedInput.success) {
    throw new TemplateFlowServiceError(
      parsedInput.error.issues[0]?.message ?? "Invalid Flow request.",
      400
    )
  }

  const request = parsedInput.data

  await authorizeFlowRequest(request, deps, startedAt)

  const [config, history, authorName] = await Promise.all([
    loadGeminiConfig(deps, request, startedAt),
    (deps.loadHistory ?? loadFlowHistory)({
      organizationId: request.organizationId,
      templateId: request.templateId
    }),
    (deps.resolveAuthorName ?? resolveFlowAuthorName)(request.actorUserId)
  ])
  const providerResult = await requestFlowProvider({
    config,
    fetchImpl: deps.fetchImpl ?? fetch,
    delayImpl: deps.delayImpl ?? delayWithAbort,
    history,
    request,
    startedAt
  })
  const providerResponse = providerResult.response
  const confirmationQuestion = readRequiredConfirmation(
    providerResponse,
    request.instruction,
    request.draft.content
  )
  const createId = deps.createId ?? randomUUID
  const applyResult =
    confirmationQuestion === null
      ? applyFlowOperations(
          request.draft,
          providerResponse.operations,
          createId
        )
      : {
          draft: request.draft,
          ledgerItems: [] as TemplateFlowLedgerItem[],
          changedBlockIds: [] as string[]
        }
  const now = deps.now?.() ?? new Date()
  const assistantContent =
    confirmationQuestion ?? providerResponse.assistantMessage
  const messages = createFlowMessages({
    actorUserId: request.actorUserId,
    assistantContent,
    authorName,
    changedBlockIds: applyResult.changedBlockIds,
    createId,
    instruction: request.instruction,
    ledgerItems: applyResult.ledgerItems,
    now
  })
  let persistenceWarning: string | null = null

  try {
    await (deps.persistMessages ?? persistFlowMessages)({
      actorUserId: request.actorUserId,
      messages,
      organizationId: request.organizationId,
      templateId: request.templateId
    })
  } catch (error: unknown) {
    persistenceWarning =
      "Flow completed the edit, but this conversation turn could not be saved."
    console.error("template_flow_history_persist_failed", {
      actorUserId: request.actorUserId,
      organizationId: request.organizationId,
      templateId: request.templateId,
      durationMs: Math.round(performance.now() - startedAt),
      reason:
        error instanceof Error ? error.message : "Unknown persistence error"
    })
  }

  console.info("template_flow_turn_completed", {
    actorUserId: request.actorUserId,
    organizationId: request.organizationId,
    templateId: request.templateId,
    model: providerResult.model,
    operationCount: applyResult.ledgerItems.length,
    needsConfirmation: confirmationQuestion !== null,
    durationMs: Math.round(performance.now() - startedAt)
  })

  return {
    draft: applyResult.draft,
    messages,
    changedBlockIds: applyResult.changedBlockIds,
    needsConfirmation: confirmationQuestion !== null,
    persistenceWarning
  }
}

/**
 * Lists the shared, template-scoped Flow history visible to a template manager.
 *
 * @param input - Authenticated actor and tenant-scoped template identifiers.
 * @param deps - Optional authorization and history adapters.
 * @returns Chronological conversation messages, bounded to the latest entries.
 * @throws TemplateFlowServiceError when access cannot be verified.
 */
export async function listTemplateFlowMessages(
  input: ListTemplateFlowMessagesInput,
  deps: Pick<
    TemplateFlowServiceDeps,
    "authorizeTemplateManagement" | "loadHistory"
  > = {}
): Promise<TemplateFlowMessage[]> {
  await (deps.authorizeTemplateManagement ?? requireTemplateManager)({
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    templateId: input.templateId
  })

  return (deps.loadHistory ?? loadFlowHistory)({
    organizationId: input.organizationId,
    templateId: input.templateId
  })
}

async function authorizeFlowRequest(
  request: z.infer<typeof flowRequestSchema>,
  deps: TemplateFlowServiceDeps,
  startedAt: number
): Promise<void> {
  try {
    await (deps.authorizeTemplateManagement ?? requireTemplateManager)({
      actorUserId: request.actorUserId,
      organizationId: request.organizationId,
      templateId: request.templateId
    })
  } catch (error: unknown) {
    if (error instanceof TemplateFlowServiceError) {
      throw error
    }

    console.error("template_flow_authorization_failed", {
      actorUserId: request.actorUserId,
      organizationId: request.organizationId,
      templateId: request.templateId,
      durationMs: Math.round(performance.now() - startedAt),
      reason:
        error instanceof Error ? error.message : "Unknown authorization error"
    })
    throw new TemplateFlowServiceError(
      "Unable to verify template editing access.",
      500
    )
  }
}

async function loadGeminiConfig(
  deps: TemplateFlowServiceDeps,
  request: z.infer<typeof flowRequestSchema>,
  startedAt: number
): Promise<GeminiEnv> {
  try {
    return (deps.getConfig ?? getGeminiEnv)()
  } catch (error: unknown) {
    console.error("template_flow_configuration_failed", {
      actorUserId: request.actorUserId,
      organizationId: request.organizationId,
      templateId: request.templateId,
      durationMs: Math.round(performance.now() - startedAt),
      reason:
        error instanceof Error ? error.message : "Unknown configuration error"
    })
    throw new TemplateFlowServiceError(
      "Flow is not configured. Add the Gemini environment variables.",
      503
    )
  }
}

async function requestFlowProvider(input: {
  config: GeminiEnv
  delayImpl: (durationMs: number, signal: AbortSignal) => Promise<void>
  fetchImpl: typeof fetch
  history: TemplateFlowMessage[]
  request: z.infer<typeof flowRequestSchema>
  startedAt: number
}): Promise<FlowProviderResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(
    (): void => controller.abort(),
    input.config.GEMINI_TIMEOUT_MS
  )
  const modelCandidates = buildGeminiModelCandidates(input.config.GEMINI_MODEL)
  let activeModel = input.config.GEMINI_MODEL
  const requestBody = {
    input: JSON.stringify({
      conversation: input.history
        .slice(-MAX_FLOW_HISTORY_MESSAGES)
        .map((message: TemplateFlowMessage) => ({
          role: message.role,
          content: message.content
        })),
      userMessage: input.request.instruction,
      currentDraft: buildFlowDocumentContext(input.request.draft)
    }),
    system_instruction: createFlowSystemInstruction(),
    store: false,
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: createGeminiTemplateFlowSchema()
    },
    generation_config: {
      max_output_tokens: GEMINI_MAX_OUTPUT_TOKENS,
      thinking_level: "low",
      thinking_summaries: "none"
    }
  }

  try {
    let response: Response | null = null

    for (const [index, model] of modelCandidates.entries()) {
      activeModel = model
      response = await fetchFlowInteraction({
        actorUserId: input.request.actorUserId,
        apiKey: input.config.GEMINI_API_KEY,
        delayImpl: input.delayImpl,
        fetchImpl: input.fetchImpl,
        model,
        organizationId: input.request.organizationId,
        requestBody: { ...requestBody, model },
        signal: controller.signal,
        startedAt: input.startedAt,
        templateId: input.request.templateId
      })

      if (response.status !== 429 && response.status !== 404) {
        break
      }

      const nextModel = modelCandidates[index + 1]

      if (nextModel === undefined) {
        break
      }

      console.warn("template_flow_provider_fallback", {
        actorUserId: input.request.actorUserId,
        organizationId: input.request.organizationId,
        templateId: input.request.templateId,
        exhaustedModel: model,
        nextModel,
        status: response.status,
        durationMs: Math.round(performance.now() - input.startedAt)
      })
    }

    if (response === null) {
      throw new Error("Gemini model selection returned no candidates.")
    }

    if (!response.ok) {
      if (response.status === 429) {
        console.warn("template_flow_provider_rate_limited", {
          actorUserId: input.request.actorUserId,
          organizationId: input.request.organizationId,
          templateId: input.request.templateId,
          model: activeModel,
          status: response.status,
          durationMs: Math.round(performance.now() - input.startedAt)
        })
        throw new TemplateFlowServiceError(
          "Flow has reached the Gemini rate limit. Wait a minute and try again.",
          429
        )
      }

      console.error("template_flow_provider_rejected", {
        actorUserId: input.request.actorUserId,
        organizationId: input.request.organizationId,
        templateId: input.request.templateId,
        model: activeModel,
        status: response.status,
        durationMs: Math.round(performance.now() - input.startedAt)
      })
      throw new TemplateFlowServiceError(
        "Flow could not update the document. Try again shortly.",
        502
      )
    }

    const responseBody = (await response.json()) as GeminiInteractionResponse
    const outputText = readGeminiOutputText(responseBody)

    if (outputText === null) {
      throw new TemplateFlowServiceError(
        "Flow did not return a usable response.",
        502
      )
    }

    let decodedOutput: unknown

    try {
      decodedOutput = JSON.parse(outputText) as unknown
    } catch {
      throw new TemplateFlowServiceError(
        "Flow returned an unreadable response.",
        502
      )
    }

    const parsedGeminiOutput =
      geminiFlowProviderResponseSchema.safeParse(decodedOutput)
    const parsedOutput = parsedGeminiOutput.success
      ? flowProviderResponseSchema.safeParse(
          normalizeGeminiFlowResponse(parsedGeminiOutput.data)
        )
      : parsedGeminiOutput

    if (!parsedOutput.success) {
      const firstIssue = parsedOutput.error.issues[0]

      console.warn("template_flow_provider_output_invalid", {
        actorUserId: input.request.actorUserId,
        organizationId: input.request.organizationId,
        templateId: input.request.templateId,
        model: activeModel,
        issueCode: firstIssue?.code ?? "unknown",
        issuePath: firstIssue?.path.join(".") ?? "unknown",
        durationMs: Math.round(performance.now() - input.startedAt)
      })
      throw new TemplateFlowServiceError(
        "Flow returned changes that failed validation.",
        502
      )
    }

    return {
      model: activeModel,
      response: parsedOutput.data
    }
  } catch (error: unknown) {
    if (error instanceof TemplateFlowServiceError) {
      throw error
    }

    const timedOut =
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")

    console.error("template_flow_request_failed", {
      actorUserId: input.request.actorUserId,
      organizationId: input.request.organizationId,
      templateId: input.request.templateId,
      model: activeModel,
      timedOut,
      durationMs: Math.round(performance.now() - input.startedAt),
      reason: error instanceof Error ? error.message : "Unknown provider error"
    })
    throw new TemplateFlowServiceError(
      timedOut
        ? "Flow timed out. Try a shorter request."
        : "Unable to complete the Flow request. Try again shortly.",
      timedOut ? 504 : 502
    )
  } finally {
    clearTimeout(timeoutId)
  }
}

function buildGeminiModelCandidates(primaryModel: string): string[] {
  return [...new Set([primaryModel, ...GEMINI_FALLBACK_MODELS])]
}

function createFlowSystemInstruction(): string {
  return [
    "You are Flow, BizFlow's accountable business-document editor.",
    "BizFlow creates reusable business documents, intake forms, agreements, approval workflows, and signing templates.",
    "Write in clear, professional, plain language. Prefer concise headings, specific field labels, and actionable instructions.",
    "Preserve the user's terminology, organization identity, document intent, and existing branding.",
    "Do not invent legal guarantees, regulatory claims, prices, dates, parties, or policies that the user did not provide.",
    "Respond conversationally and use operations only when the user asks to change the current draft.",
    "The document status, publication state, and archive state are outside your control.",
    "Preserve all content, stable field keys, image bytes, and branding that the user did not ask to change.",
    "The document has one ordered free-form block flow bounded by printable page margins; there are no header, body, or footer sections.",
    "Never remove a logo, image, field, or content block unless the user explicitly requests removal.",
    "When a request could cause unintended loss, return needsConfirmation=true, a single clear confirmationQuestion, and no operations.",
    "Use only ids present in currentDraft when updating, moving, or removing blocks.",
    "Use add_block for new content; use update_block with a complete replacement block without id for non-image edits.",
    "Use update_image to change an existing image's placement, size, caption, or alt text; you cannot replace its bytes.",
    "Use move_block to reorganize content while preserving its id.",
    "Use only canonical block types: heading, paragraph, bullet_list, numbered_list, table, divider, text_field, date_field, checkbox_field, dropdown_field, initials_field, signature_field, or file_field.",
    "List items are plain strings. Never use a generic list type or objects for list items.",
    "Every operation must include type, summary, and payloadJson.",
    "payloadJson must be one compact valid JSON object encoded as a string, with no Markdown or commentary.",
    createFlowPayloadContract(),
    "Keep assistantMessage concise and explain what was preserved when relevant.",
    "Return only the requested structured response."
  ].join(" ")
}

function createFlowPayloadContract(): string {
  return [
    "Operation payload contracts:",
    'set_title => {"value":"Document title"}.',
    'set_description => {"value":"Document description"}.',
    'set_branding => include only requested properties from {"organizationName":"Name","primaryColor":"#RRGGBB","accentColor":"#RRGGBB","logoAlignment":"left|center|right","logoWidthPercent":25,"removeLogo":false}.',
    'add_block => {"afterBlockId":"existing-uuid-or-null","block":{...new block without id}}.',
    'update_block => {"blockId":"existing-uuid","block":{...complete replacement block without id}}.',
    'update_image => {"blockId":"existing-uuid","altText":"Description","caption":null,"alignment":"left|center|right","widthPercent":50}.',
    'move_block => {"blockId":"existing-uuid","afterBlockId":"existing-uuid-or-null"}.',
    'remove_block => {"blockId":"existing-uuid"}.',
    "Block contracts:",
    'heading {"type":"heading","text":"Text","level":1|2|3,"alignment":"left|center|right"};',
    'paragraph {"type":"paragraph","text":"Text","alignment":"left|center|right"};',
    'bullet_list {"type":"bullet_list","items":["Plain text"]};',
    'numbered_list {"type":"numbered_list","items":["Plain text"]};',
    'table {"type":"table","headers":["Header"],"rows":[["Cell"]]};',
    'divider {"type":"divider"};',
    'text_field {"type":"text_field","fieldKey":"stable_key","label":"Label","required":true,"helpText":null,"placeholder":null,"multiline":false};',
    'date_field {"type":"date_field","fieldKey":"stable_key","label":"Label","required":true,"helpText":null};',
    'initials_field {"type":"initials_field","fieldKey":"stable_key","label":"Label","required":true,"helpText":null};',
    'signature_field {"type":"signature_field","fieldKey":"stable_key","label":"Label","required":true,"helpText":null};',
    'file_field {"type":"file_field","fieldKey":"stable_key","label":"Label","required":true,"helpText":null};',
    'checkbox_field {"type":"checkbox_field","fieldKey":"stable_key","label":"Label","required":true,"helpText":null,"checkedByDefault":false};',
    'dropdown_field {"type":"dropdown_field","fieldKey":"stable_key","label":"Label","required":true,"helpText":null,"placeholder":null,"options":["Option"]}.'
  ].join(" ")
}

function normalizeGeminiFlowResponse(
  response: z.infer<typeof geminiFlowProviderResponseSchema>
): unknown {
  return {
    assistantMessage: response.assistantMessage,
    needsConfirmation: response.needsConfirmation,
    confirmationQuestion: response.confirmationQuestion,
    operations: response.operations.map(
      (
        operation: z.infer<
          typeof geminiFlowProviderResponseSchema
        >["operations"][number]
      ): Record<string, unknown> => ({
        type: operation.type,
        summary: operation.summary,
        payload: parseGeminiPayloadJson(operation.payloadJson)
      })
    )
  }
}

function parseGeminiPayloadJson(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson) as unknown
  } catch {
    return null
  }
}

function buildFlowDocumentContext(
  draft: TemplateFlowDraft
): Record<string, unknown> {
  let usedCharacters = 0
  const blocks: unknown[] = []
  let omittedBlockCount = 0

  for (const block of draft.content.blocks) {
    const sanitizedBlock =
      block.type === "image"
        ? {
            id: block.id,
            type: block.type,
            altText: block.altText,
            caption: block.caption,
            alignment: block.alignment,
            widthPercent: block.widthPercent,
            imageDataOmitted: true
          }
        : block
    const characterCount = JSON.stringify(sanitizedBlock).length

    if (usedCharacters + characterCount > MAX_FLOW_CONTEXT_CHARACTERS) {
      omittedBlockCount += 1
      continue
    }

    blocks.push(sanitizedBlock)
    usedCharacters += characterCount
  }

  return {
    title: draft.title,
    description: draft.description,
    branding: {
      organizationName: draft.content.branding.organizationName,
      primaryColor: draft.content.branding.primaryColor,
      accentColor: draft.content.branding.accentColor,
      hasLogo: draft.content.branding.logoDataUrl !== null,
      logoAlignment: draft.content.branding.logoAlignment,
      logoWidthPercent: draft.content.branding.logoWidthPercent
    },
    blocks,
    omittedBlockCount
  }
}

function readRequiredConfirmation(
  response: FlowProviderResponse,
  instruction: string,
  content: TemplateContent
): string | null {
  if (response.needsConfirmation) {
    return (
      response.confirmationQuestion ||
      "Before I make that change, which content should be removed?"
    )
  }

  const logoRemovalOperations = response.operations.filter(
    (operation: FlowWireOperation): boolean =>
      operationRequestsLogoRemoval(operation)
  )

  if (
    logoRemovalOperations.length > 0 &&
    !hasExplicitLogoRemovalIntent(instruction)
  ) {
    return "That change would remove the existing logo. Should I remove it?"
  }

  const removeOperations = response.operations.filter(
    (operation: FlowWireOperation): boolean => operation.type === "remove_block"
  )

  if (removeOperations.length === 0 || hasExplicitRemovalIntent(instruction)) {
    return null
  }

  const removesImage = removeOperations.some(
    (operation: FlowWireOperation): boolean =>
      operationRemovesExistingImage(operation, content)
  )

  return removesImage
    ? "That change may remove an existing image or logo. Should I remove it?"
    : "That change may remove existing document content. Which content should I remove?"
}

function hasExplicitRemovalIntent(instruction: string): boolean {
  return /\b(remove|delete|drop|clear|eliminate|discard)\b/i.test(instruction)
}

function hasExplicitLogoRemovalIntent(instruction: string): boolean {
  return (
    /\b(remove|delete|clear|discard)\b.{0,40}\blogo\b/i.test(instruction) ||
    /\blogo\b.{0,40}\b(remove|delete|clear|discard)\b/i.test(instruction)
  )
}

function operationRequestsLogoRemoval(operation: FlowWireOperation): boolean {
  return (
    operation.type === "set_branding" && operation.payload.removeLogo === true
  )
}

function operationRemovesExistingImage(
  operation: FlowWireOperation,
  content: TemplateContent
): boolean {
  if (operation.type === "set_branding") {
    return operationRequestsLogoRemoval(operation)
  }

  if (operation.type !== "remove_block") {
    return false
  }

  return content.blocks.some(
    (block: TemplateBlock): boolean =>
      block.id === operation.payload.blockId && block.type === "image"
  )
}

function describeOperationTarget(
  draft: TemplateFlowDraft,
  operation: FlowWireOperation
): string {
  switch (operation.type) {
    case "set_title":
      return "Document title"
    case "set_description":
      return "Document description"
    case "set_branding":
      return "Document branding"
    case "add_block":
      return describeBlockTarget(operation.payload.block)
    case "update_block":
    case "update_image":
    case "move_block":
    case "remove_block": {
      const block = draft.content.blocks.find(
        (candidate: TemplateBlock): boolean =>
          candidate.id === operation.payload.blockId
      )

      return block ? describeBlockTarget(block) : "Document element"
    }
  }
}

function describeBlockTarget(block: GeneratedBlock | TemplateBlock): string {
  switch (block.type) {
    case "heading":
      return boundLedgerTarget(`Heading · ${block.text}`)
    case "paragraph":
      return block.text.length > 0
        ? boundLedgerTarget(`Paragraph · ${block.text}`)
        : "Paragraph"
    case "bullet_list":
      return "Bulleted list"
    case "numbered_list":
      return "Numbered list"
    case "table":
      return boundLedgerTarget(`Table · ${block.headers.join(" · ")}`)
    case "divider":
      return "Divider"
    case "image":
      return boundLedgerTarget(
        `Image · ${block.caption || block.altText || "Untitled"}`
      )
    case "text_field":
    case "date_field":
    case "checkbox_field":
    case "dropdown_field":
    case "initials_field":
    case "signature_field":
    case "file_field":
      return boundLedgerTarget(`Field · ${block.label}`)
  }
}

function boundLedgerTarget(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 179)}…`
}

function applyFlowOperations(
  currentDraft: TemplateFlowDraft,
  operations: FlowWireOperation[],
  createId: () => string
): {
  draft: TemplateFlowDraft
  ledgerItems: TemplateFlowLedgerItem[]
  changedBlockIds: string[]
} {
  const nextDraft = structuredClone(currentDraft) as TemplateFlowDraft
  const ledgerItems: TemplateFlowLedgerItem[] = []
  const changedBlockIds = new Set<string>()

  for (const operation of operations) {
    const target = describeOperationTarget(nextDraft, operation)
    const affectedBlockIds = applyFlowOperation(nextDraft, operation, createId)

    affectedBlockIds.forEach((blockId: string): void => {
      changedBlockIds.add(blockId)
    })
    ledgerItems.push({
      id: createId(),
      type: operation.type,
      summary: operation.summary,
      target,
      affectedBlockIds
    })
  }

  const parsedDraft = flowDraftSchema.safeParse(nextDraft)

  if (!parsedDraft.success) {
    throw new TemplateFlowServiceError(
      "Flow produced a document that failed validation.",
      502
    )
  }

  return {
    draft: parsedDraft.data,
    ledgerItems,
    changedBlockIds: [...changedBlockIds]
  }
}

function applyFlowOperation(
  draft: TemplateFlowDraft,
  operation: FlowWireOperation,
  createId: () => string
): string[] {
  switch (operation.type) {
    case "set_title":
      draft.title = operation.payload.value
      return []
    case "set_description":
      draft.description = operation.payload.value
      return []
    case "set_branding":
      applyBrandingOperation(draft, operation.payload)
      return []
    case "add_block":
      return applyAddBlockOperation(draft, operation.payload, createId)
    case "update_block":
      return applyUpdateBlockOperation(draft, operation.payload)
    case "update_image":
      return applyUpdateImageOperation(draft, operation.payload)
    case "move_block":
      return applyMoveBlockOperation(draft, operation.payload)
    case "remove_block":
      return applyRemoveBlockOperation(draft, operation.payload)
  }
}

function applyBrandingOperation(
  draft: TemplateFlowDraft,
  payload: FlowOperationPayload<"set_branding">
): void {
  if (payload.organizationName !== undefined) {
    draft.content.branding.organizationName = payload.organizationName
  }
  if (payload.primaryColor !== undefined) {
    draft.content.branding.primaryColor = payload.primaryColor
  }
  if (payload.accentColor !== undefined) {
    draft.content.branding.accentColor = payload.accentColor
  }
  if (payload.logoAlignment !== undefined) {
    draft.content.branding.logoAlignment = payload.logoAlignment
  }
  if (payload.logoWidthPercent !== undefined) {
    draft.content.branding.logoWidthPercent = payload.logoWidthPercent
  }
  if (payload.removeLogo === true) {
    draft.content.branding.logoDataUrl = null
  }
}

function applyAddBlockOperation(
  draft: TemplateFlowDraft,
  payload: FlowOperationPayload<"add_block">,
  createId: () => string
): string[] {
  const blockId = createId()
  const candidate = ensureUniqueFieldKey(
    { ...payload.block, id: blockId },
    draft.content
  )
  const block = parseCanonicalBlock(candidate)
  const blocks = draft.content.blocks

  if (payload.afterBlockId === null) {
    blocks.push(block)
    return [block.id]
  }

  const targetIndex = blocks.findIndex(
    (existingBlock: TemplateBlock): boolean =>
      existingBlock.id === payload.afterBlockId
  )

  if (targetIndex === -1) {
    throw invalidOperationError()
  }

  blocks.splice(targetIndex + 1, 0, block)
  return [block.id]
}

function applyUpdateBlockOperation(
  draft: TemplateFlowDraft,
  payload: FlowOperationPayload<"update_block">
): string[] {
  const blocks = draft.content.blocks
  const blockIndex = blocks.findIndex(
    (block: TemplateBlock): boolean => block.id === payload.blockId
  )

  if (blockIndex === -1) {
    throw invalidOperationError()
  }

  const existingBlock = blocks[blockIndex]

  if (
    existingBlock?.type === "image" ||
    payload.block.type !== existingBlock?.type
  ) {
    throw invalidOperationError()
  }

  const candidate = ensureUniqueFieldKey(
    { ...payload.block, id: payload.blockId },
    draft.content,
    payload.blockId
  )
  blocks[blockIndex] = parseCanonicalBlock(candidate)
  return [payload.blockId]
}

function applyUpdateImageOperation(
  draft: TemplateFlowDraft,
  payload: FlowOperationPayload<"update_image">
): string[] {
  const blocks = draft.content.blocks
  const blockIndex = blocks.findIndex(
    (block: TemplateBlock): boolean => block.id === payload.blockId
  )
  const existingBlock = blocks[blockIndex]

  if (blockIndex === -1 || existingBlock?.type !== "image") {
    throw invalidOperationError()
  }

  blocks[blockIndex] = {
    ...existingBlock,
    altText: payload.altText,
    caption: payload.caption,
    alignment: payload.alignment,
    widthPercent: payload.widthPercent
  }
  return [payload.blockId]
}

function applyMoveBlockOperation(
  draft: TemplateFlowDraft,
  payload: FlowOperationPayload<"move_block">
): string[] {
  const blocks = draft.content.blocks
  const sourceIndex = blocks.findIndex(
    (block: TemplateBlock): boolean => block.id === payload.blockId
  )

  if (sourceIndex === -1 || payload.afterBlockId === payload.blockId) {
    throw invalidOperationError()
  }

  const [block] = blocks.splice(sourceIndex, 1)

  if (!block) {
    throw invalidOperationError()
  }

  if (payload.afterBlockId === null) {
    blocks.unshift(block)
    return [block.id]
  }

  const targetIndex = blocks.findIndex(
    (candidate: TemplateBlock): boolean => candidate.id === payload.afterBlockId
  )

  if (targetIndex === -1) {
    blocks.splice(sourceIndex, 0, block)
    throw invalidOperationError()
  }

  blocks.splice(targetIndex + 1, 0, block)
  return [block.id]
}

function applyRemoveBlockOperation(
  draft: TemplateFlowDraft,
  payload: FlowOperationPayload<"remove_block">
): string[] {
  const blocks = draft.content.blocks
  const blockIndex = blocks.findIndex(
    (block: TemplateBlock): boolean => block.id === payload.blockId
  )

  if (blockIndex === -1) {
    throw invalidOperationError()
  }

  blocks.splice(blockIndex, 1)
  return [payload.blockId]
}

function parseCanonicalBlock(candidate: unknown): TemplateBlock {
  const result = templateBlockSchema.safeParse(candidate)

  if (!result.success) {
    throw invalidOperationError()
  }

  return result.data
}

function ensureUniqueFieldKey(
  candidate: Record<string, unknown>,
  content: TemplateContent,
  excludedBlockId?: string
): Record<string, unknown> {
  if (typeof candidate.fieldKey !== "string") {
    return candidate
  }

  const usedFieldKeys = new Set<string>()

  for (const block of content.blocks) {
    if ("fieldKey" in block && block.id !== excludedBlockId) {
      usedFieldKeys.add(block.fieldKey.toLowerCase())
    }
  }

  const originalKey = candidate.fieldKey
  let nextKey = originalKey
  let suffix = 2

  while (usedFieldKeys.has(nextKey.toLowerCase())) {
    const suffixText = `_${suffix}`
    nextKey = `${originalKey.slice(0, 80 - suffixText.length)}${suffixText}`
    suffix += 1
  }

  return { ...candidate, fieldKey: nextKey }
}

function invalidOperationError(): TemplateFlowServiceError {
  return new TemplateFlowServiceError(
    "Flow returned an edit operation that failed validation.",
    502
  )
}

function createFlowMessages(input: {
  actorUserId: string
  assistantContent: string
  authorName: string
  changedBlockIds: string[]
  createId: () => string
  instruction: string
  ledgerItems: TemplateFlowLedgerItem[]
  now: Date
}): [TemplateFlowMessage, TemplateFlowMessage] {
  const createdAt = input.now.toISOString()

  return [
    {
      id: input.createId(),
      role: "user",
      content: input.instruction,
      authorName: input.authorName,
      operations: [],
      changedBlockIds: [],
      createdAt
    },
    {
      id: input.createId(),
      role: "assistant",
      content: input.assistantContent,
      authorName: null,
      operations: input.ledgerItems,
      changedBlockIds: input.changedBlockIds,
      createdAt
    }
  ]
}

async function requireTemplateManager(input: {
  actorUserId: string
  organizationId: string
  templateId: string
}): Promise<void> {
  const client: TemplateFlowClient = createAdminClient()
  const [{ data: membershipData, error: membershipError }, templateResult] =
    await Promise.all([
      client
        .from("organization_memberships")
        .select("role,status")
        .eq("org_id", input.organizationId)
        .eq("user_id", input.actorUserId)
        .eq("status", "active")
        .maybeSingle(),
      client
        .from("document_templates")
        .select("id,status")
        .eq("org_id", input.organizationId)
        .eq("id", input.templateId)
        .maybeSingle()
    ])

  if (membershipError || templateResult.error) {
    throw new TemplateFlowServiceError(
      "Unable to verify template editing access.",
      500
    )
  }

  const membership = membershipData as {
    role?: unknown
    status?: unknown
  } | null
  const template = templateResult.data as {
    id?: unknown
    status?: unknown
  } | null

  if (
    membership?.status !== "active" ||
    (membership.role !== "owner_admin" && membership.role !== "manager")
  ) {
    throw new TemplateFlowServiceError(
      "Only organization owners and managers can use Flow.",
      403
    )
  }

  if (!template?.id) {
    throw new TemplateFlowServiceError("Template not found.", 404)
  }

  if (template.status === "archived") {
    throw new TemplateFlowServiceError(
      "Archived templates cannot be changed.",
      409
    )
  }
}

async function loadFlowHistory(input: {
  organizationId: string
  templateId: string
}): Promise<TemplateFlowMessage[]> {
  const client = createAdminClient()
  const { data, error } = await client
    .from("template_flow_messages")
    .select("*")
    .eq("org_id", input.organizationId)
    .eq("template_id", input.templateId)
    .order("created_at", { ascending: false })
    .limit(100)

  if (error) {
    console.warn("template_flow_history_load_failed", {
      organizationId: input.organizationId,
      templateId: input.templateId,
      reason: error.message
    })
    return []
  }

  return ((data ?? []) as TemplateFlowMessageRow[])
    .reverse()
    .map(mapFlowMessageRow)
}

async function persistFlowMessages(input: {
  messages: [TemplateFlowMessage, TemplateFlowMessage]
  organizationId: string
  templateId: string
  actorUserId: string
}): Promise<void> {
  const client = createAdminClient()
  const rows = input.messages.map(
    (message: TemplateFlowMessage): TemplateFlowMessageRow => ({
      id: message.id,
      org_id: input.organizationId,
      template_id: input.templateId,
      author_user_id: message.role === "user" ? input.actorUserId : null,
      author_name: message.authorName,
      role: message.role,
      content: message.content,
      change_set:
        message.operations.length > 0 || message.changedBlockIds.length > 0
          ? {
              operations: message.operations,
              changedBlockIds: message.changedBlockIds
            }
          : null,
      created_at: message.createdAt
    })
  )
  const { error } = await client.from("template_flow_messages").insert(rows)

  if (error) {
    throw new Error(error.message)
  }
}

async function resolveFlowAuthorName(actorUserId: string): Promise<string> {
  const client = createAdminClient()
  const { data, error } = await client
    .from("profiles")
    .select("full_name,email")
    .eq("id", actorUserId)
    .maybeSingle()

  if (error) {
    console.warn("template_flow_author_load_failed", {
      actorUserId,
      reason: error.message
    })
    return "Team member"
  }

  const profile = data as { full_name?: unknown; email?: unknown } | null

  if (
    typeof profile?.full_name === "string" &&
    profile.full_name.trim().length > 0
  ) {
    return profile.full_name.trim()
  }

  if (typeof profile?.email === "string" && profile.email.includes("@")) {
    return profile.email.split("@")[0] || "Team member"
  }

  return "Team member"
}

function mapFlowMessageRow(row: TemplateFlowMessageRow): TemplateFlowMessage {
  const changeSet = isRecord(row.change_set) ? row.change_set : {}
  const operations = Array.isArray(changeSet.operations)
    ? changeSet.operations
        .map(parseLedgerItem)
        .filter(
          (
            item: TemplateFlowLedgerItem | null
          ): item is TemplateFlowLedgerItem => item !== null
        )
    : []
  const changedBlockIds = Array.isArray(changeSet.changedBlockIds)
    ? changeSet.changedBlockIds.filter(
        (blockId: unknown): blockId is string => typeof blockId === "string"
      )
    : []

  return {
    id: row.id,
    role: row.role,
    content: row.content,
    authorName: row.author_name,
    operations,
    changedBlockIds,
    createdAt: row.created_at
  }
}

function parseLedgerItem(value: unknown): TemplateFlowLedgerItem | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    !TEMPLATE_FLOW_OPERATION_TYPES.includes(
      value.type as TemplateFlowOperationType
    ) ||
    typeof value.summary !== "string" ||
    typeof value.target !== "string" ||
    !Array.isArray(value.affectedBlockIds)
  ) {
    return null
  }

  return {
    id: value.id,
    type: value.type as TemplateFlowOperationType,
    summary: value.summary,
    target: value.target,
    affectedBlockIds: value.affectedBlockIds.filter(
      (blockId: unknown): blockId is string => typeof blockId === "string"
    )
  }
}

async function fetchFlowInteraction(input: {
  actorUserId: string
  apiKey: string
  delayImpl: (durationMs: number, signal: AbortSignal) => Promise<void>
  fetchImpl: typeof fetch
  model: string
  organizationId: string
  requestBody: Record<string, unknown>
  signal: AbortSignal
  startedAt: number
  templateId: string
}): Promise<Response> {
  for (let attempt = 1; attempt <= GEMINI_MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await input.fetchImpl(GEMINI_INTERACTIONS_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": input.apiKey
        },
        body: JSON.stringify(input.requestBody),
        signal: input.signal
      })

      if (
        response.ok ||
        !isRetryableGeminiStatus(response.status) ||
        attempt === GEMINI_MAX_REQUEST_ATTEMPTS
      ) {
        return response
      }

      await waitBeforeFlowRetry(input, attempt, response.status)
    } catch (error: unknown) {
      if (
        isAbortError(error, input.signal) ||
        attempt === GEMINI_MAX_REQUEST_ATTEMPTS
      ) {
        throw error
      }

      console.warn("template_flow_provider_retry", {
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        templateId: input.templateId,
        model: input.model,
        attempt,
        status: null,
        durationMs: Math.round(performance.now() - input.startedAt),
        reason: error instanceof Error ? error.message : "Unknown network error"
      })
      await input.delayImpl(calculateRetryDelayMs(attempt), input.signal)
    }
  }

  throw new Error("Gemini request exhausted all attempts.")
}

async function waitBeforeFlowRetry(
  input: Parameters<typeof fetchFlowInteraction>[0],
  attempt: number,
  status: number
): Promise<void> {
  const delayMs = calculateRetryDelayMs(attempt)

  console.warn("template_flow_provider_retry", {
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    templateId: input.templateId,
    model: input.model,
    attempt,
    status,
    delayMs,
    durationMs: Math.round(performance.now() - input.startedAt)
  })
  await input.delayImpl(delayMs, input.signal)
}

function isRetryableGeminiStatus(status: number): boolean {
  return status === 408 || status >= 500
}

function calculateRetryDelayMs(attempt: number): number {
  const exponentialDelay = GEMINI_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
  const jitterMs = Math.floor(Math.random() * GEMINI_RETRY_BASE_DELAY_MS)
  return exponentialDelay + jitterMs
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted || (error instanceof Error && error.name === "AbortError")
  )
}

function delayWithAbort(
  durationMs: number,
  signal: AbortSignal
): Promise<void> {
  return new Promise<void>(
    (resolve: () => void, reject: (reason: Error) => void): void => {
      if (signal.aborted) {
        reject(createAbortError())
        return
      }

      const onAbort = (): void => {
        clearTimeout(timeoutId)
        reject(createAbortError())
      }
      const timeoutId = setTimeout((): void => {
        signal.removeEventListener("abort", onAbort)
        resolve()
      }, durationMs)

      signal.addEventListener("abort", onAbort, { once: true })
    }
  )
}

function createAbortError(): Error {
  const error = new Error("Gemini request aborted.")
  error.name = "AbortError"
  return error
}

function readGeminiOutputText(
  response: GeminiInteractionResponse
): string | null {
  if (response.status !== undefined && response.status !== "completed") {
    return null
  }

  for (let index = (response.steps ?? []).length - 1; index >= 0; index -= 1) {
    const step = response.steps?.[index]

    if (step?.type !== "model_output") {
      continue
    }

    const text = (step.content ?? [])
      .filter(
        (part): part is { type?: string; text: string } =>
          part.type === "text" &&
          typeof part.text === "string" &&
          part.text.length > 0
      )
      .map((part: { type?: string; text: string }): string => part.text)
      .join("")

    if (text.length > 0) {
      return text
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
