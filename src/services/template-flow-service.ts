import { randomUUID } from "node:crypto"

import { z } from "zod"

import {
  createAdminClient,
  type AdminSupabaseClient
} from "@/lib/supabase/admin"
import {
  type AiModelReference,
  type AiRuntime,
  type AiStructuredGenerationResult,
  type AiTokenUsage
} from "@/services/ai/contracts"
import {
  AI_PROVIDER_ERROR_CODES,
  AiProviderError
} from "@/services/ai/errors"
import { createAiRuntime } from "@/services/ai/provider-factory"
import { createTemplateFlowDraftFingerprint } from "@/services/template-flow-proposal-state"
import {
  createTemplateFlowResponseSchema,
  TEMPLATE_FLOW_OPERATION_TYPES
} from "@/services/template-ai/flow-response-schema"
import {
  evaluateTemplateQuality,
  type TemplateQualityIssue
} from "@/services/templates/template-quality-service"
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
  templateContentV3Schema,
  textFieldBlockSchema,
  upgradeV2TemplateContentToV3,
  type TemplateBlock,
  type TemplateContent,
  type TemplateContentV3
} from "@/types/template"
import {
  createUniqueTemplateFieldKey,
  deleteTemplateBlock,
  insertTemplateBlock,
  isTemplateFieldBlock,
  moveTemplateBlockAfter,
  updateTemplateBlock
} from "@/types/template-structure"
import type {
  TemplateFlowDraft,
  TemplateFlowLedgerItem,
  TemplateFlowMessage,
  TemplateFlowMessageRow,
  TemplateFlowOperationType,
  TemplateFlowProposal,
  TemplateFlowQualityIssue,
  TemplateFlowResult
} from "@/types/template-flow"

const FLOW_MAX_OUTPUT_TOKENS = 8_192
const FLOW_MAX_UPSTREAM_CALLS = 2
const MAX_FLOW_REPAIR_RESPONSE_CHARACTERS = 12_000
const MAX_FLOW_HISTORY_MESSAGES = 20
const MAX_FLOW_CONTEXT_CHARACTERS = 55_000
const MAX_FLOW_STRUCTURE_CONTEXT_CHARACTERS = 10_000

const uuidSchema = z.string().uuid()
const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/)
const generatedFieldKeySchema = z.string().trim().min(1).max(240)
const flowDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().max(2_000),
    content: templateContentSchema
  })
  .strict()
const editableFlowDraftSchema = flowDraftSchema
  .extend({ content: templateContentV3Schema })
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
  textFieldBlockSchema
    .omit({ id: true, fieldKey: true })
    .extend({ fieldKey: generatedFieldKeySchema })
    .strict(),
  dateFieldBlockSchema
    .omit({ id: true, fieldKey: true })
    .extend({ fieldKey: generatedFieldKeySchema })
    .strict(),
  checkboxFieldBlockSchema
    .omit({ id: true, fieldKey: true })
    .extend({ fieldKey: generatedFieldKeySchema })
    .strict(),
  dropdownFieldBlockSchema
    .omit({ id: true, fieldKey: true })
    .extend({ fieldKey: generatedFieldKeySchema })
    .strict(),
  initialsFieldBlockSchema
    .omit({ id: true, fieldKey: true })
    .extend({ fieldKey: generatedFieldKeySchema })
    .strict(),
  signatureFieldBlockSchema
    .omit({ id: true, fieldKey: true })
    .extend({ fieldKey: generatedFieldKeySchema })
    .strict(),
  fileFieldBlockSchema
    .omit({ id: true, fieldKey: true })
    .extend({ fieldKey: generatedFieldKeySchema })
    .strict()
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
const flowStructuredResponseSchema = z
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
  model: AiModelReference
  response: FlowProviderResponse
  application: FlowApplicationResult | null
  confirmationQuestion: string | null
  qualityIssues: TemplateFlowQualityIssue[]
  traceId: string
  upstreamCalls: number
  usage: AiTokenUsage
}
type FlowProviderParseResult =
  | {
      success: true
      data: FlowProviderResponse
    }
  | {
      success: false
      issueCode: string
      issuePath: string
    }
type FlowWireOperation = z.infer<typeof flowWireOperationSchema>
type GeneratedBlock = z.infer<typeof generatedBlockSchema>
type ParsedFlowRequest = z.infer<typeof flowRequestSchema>
type EditableFlowDraft = z.infer<typeof editableFlowDraftSchema>
type EditableFlowRequest = Omit<ParsedFlowRequest, "draft"> & {
  draft: EditableFlowDraft
}
type FlowOperationPayload<T extends TemplateFlowOperationType> = Extract<
  FlowWireOperation,
  { type: T }
>["payload"]
type FlowApplicationResult = {
  draft: EditableFlowDraft
  ledgerItems: TemplateFlowLedgerItem[]
  changedBlockIds: string[]
}
type TemplateFlowProposalReceipt = {
  proposalId: string
  status: "proposed"
  baseDraftFingerprint: string
}
type FlowCandidateValidationResult =
  | {
      success: true
      application: FlowApplicationResult | null
      confirmationQuestion: string | null
      qualityIssues: TemplateFlowQualityIssue[]
    }
  | {
      success: false
      issueCode: string
      issuePath: string
    }
type TemplateFlowClient = Pick<AdminSupabaseClient, "from">

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
  createTraceId?: () => string
  getAiRuntime?: () => AiRuntime
  loadHistory?: (input: {
    organizationId: string
    templateId: string
  }) => Promise<TemplateFlowMessage[]>
  now?: () => Date
  persistMessages?: (input: {
    messages: [TemplateFlowMessage, TemplateFlowMessage]
    proposalReceipt: TemplateFlowProposalReceipt | null
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
 * schema before it reaches the browser as a pending proposal.
 *
 * @param input - Authenticated actor, template, draft, and conversational request.
 * @param deps - Optional authorization, persistence, provider, and clock adapters.
 * @returns A pending coherent proposal, or null, plus two attributed messages.
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

  // Fingerprint the exact JSON-compatible browser base before Zod applies
  // trimming or schema defaults, so an unchanged submitted draft still matches.
  const baseDraftFingerprint = createTemplateFlowDraftFingerprint(
    input.draft as TemplateFlowDraft
  )

  const request: EditableFlowRequest = {
    ...parsedInput.data,
    draft: {
      ...parsedInput.data.draft,
      content: upgradeV2TemplateContentToV3(parsedInput.data.draft.content)
    }
  }

  await authorizeFlowRequest(request, deps, startedAt)

  const [aiRuntime, history, authorName] = await Promise.all([
    loadAiRuntime(deps, request, startedAt),
    (deps.loadHistory ?? loadFlowHistory)({
      organizationId: request.organizationId,
      templateId: request.templateId
    }),
    (deps.resolveAuthorName ?? resolveFlowAuthorName)(request.actorUserId)
  ])
  const createId = deps.createId ?? randomUUID
  const providerResult = await requestFlowProvider({
    createId,
    history,
    runtime: aiRuntime,
    request,
    startedAt,
    traceId: deps.createTraceId?.() ?? randomUUID()
  })
  const providerResponse = providerResult.response
  const application = providerResult.application
  const proposal: TemplateFlowProposal | null =
    application === null
      ? null
      : {
          id: createId(),
          status: "pending",
          baseDraftFingerprint,
          candidateDraft: application.draft,
          operations: application.ledgerItems,
          changedBlockIds: application.changedBlockIds,
          qualityIssues: providerResult.qualityIssues
        }
  const now = deps.now?.() ?? new Date()
  const assistantContent =
    providerResult.confirmationQuestion ??
    createProposedAssistantContent(providerResponse.assistantMessage, proposal)
  const messages = createFlowMessages({
    actorUserId: request.actorUserId,
    assistantContent,
    authorName,
    changedBlockIds: proposal?.changedBlockIds ?? [],
    createId,
    instruction: request.instruction,
    ledgerItems: proposal?.operations ?? [],
    now
  })
  let persistenceWarning: string | null = null

  try {
    await (deps.persistMessages ?? persistFlowMessages)({
      actorUserId: request.actorUserId,
      messages,
      proposalReceipt:
        proposal === null
          ? null
          : {
              proposalId: proposal.id,
              status: "proposed",
              baseDraftFingerprint: proposal.baseDraftFingerprint
            },
      organizationId: request.organizationId,
      templateId: request.templateId
    })
  } catch (error: unknown) {
    persistenceWarning = proposal
      ? "Flow created the proposal, but this conversation turn could not be saved."
      : "Flow responded, but this conversation turn could not be saved."
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
    provider: providerResult.model.provider,
    model: providerResult.model.model,
    traceId: providerResult.traceId,
    operationCount: proposal?.operations.length ?? 0,
    proposalId: proposal?.id ?? null,
    needsConfirmation: providerResult.confirmationQuestion !== null,
    // Spend signal: hard-bounded upstream calls plus billed tokens when the
    // provider reports them. This is the only per-turn cost record kept here.
    upstreamCalls: providerResult.upstreamCalls,
    inputTokens: providerResult.usage.inputTokens,
    outputTokens: providerResult.usage.outputTokens,
    totalTokens: providerResult.usage.totalTokens,
    durationMs: Math.round(performance.now() - startedAt)
  })

  return {
    proposal,
    messages,
    needsConfirmation: providerResult.confirmationQuestion !== null,
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
  request: EditableFlowRequest,
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

async function loadAiRuntime(
  deps: TemplateFlowServiceDeps,
  request: EditableFlowRequest,
  startedAt: number
): Promise<AiRuntime> {
  try {
    return (deps.getAiRuntime ?? createAiRuntime)()
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
      "Flow is not configured. Add the AI environment variables.",
      503
    )
  }
}

async function requestFlowProvider(input: {
  createId: () => string
  history: TemplateFlowMessage[]
  request: EditableFlowRequest
  runtime: AiRuntime
  startedAt: number
  traceId: string
}): Promise<FlowProviderResult> {
  const model = input.runtime.model

  if (input.runtime.provider.id !== model.provider) {
    console.error("template_flow_provider_configuration_mismatch", {
      actorUserId: input.request.actorUserId,
      organizationId: input.request.organizationId,
      templateId: input.request.templateId,
      configuredProvider: model.provider,
      adapterProvider: input.runtime.provider.id,
      model: model.model,
      durationMs: Math.round(performance.now() - input.startedAt)
    })
    throw new TemplateFlowServiceError(
      "Flow provider configuration does not match the requested model.",
      503
    )
  }

  const systemInstruction = createFlowSystemInstruction()
  const responseSchema = createTemplateFlowResponseSchema()
  const initialPrompt = JSON.stringify({
    conversation: input.history
      .slice(-MAX_FLOW_HISTORY_MESSAGES)
      .map((message: TemplateFlowMessage) => ({
        role: message.role,
        content: message.content
      })),
    userMessage: input.request.instruction,
    currentDraft: buildFlowDocumentContext(input.request.draft)
  })
  const usageReports: AiTokenUsage[] = []
  let currentPrompt = initialPrompt
  let upstreamCalls = 0
  let latestTraceId = input.traceId

  for (
    let providerCall = 1;
    providerCall <= FLOW_MAX_UPSTREAM_CALLS;
    providerCall += 1
  ) {
    let result: AiStructuredGenerationResult

    try {
      result = await input.runtime.provider.generateStructured({
        model,
        input: currentPrompt,
        systemInstruction,
        responseSchema,
        maxOutputTokens: FLOW_MAX_OUTPUT_TOKENS,
        traceId: input.traceId
      })
    } catch (error: unknown) {
      throwFlowProviderError(error, input, model)
    }

    assertFlowProviderResultModel(result, model, input)

    upstreamCalls += result.upstreamCalls
    latestTraceId = result.traceId
    usageReports.push(result.usage)

    if (upstreamCalls > FLOW_MAX_UPSTREAM_CALLS) {
      console.error("template_flow_provider_call_budget_exceeded", {
        actorUserId: input.request.actorUserId,
        organizationId: input.request.organizationId,
        templateId: input.request.templateId,
        provider: model.provider,
        model: model.model,
        traceId: latestTraceId,
        upstreamCalls,
        durationMs: Math.round(performance.now() - input.startedAt)
      })
      throw new TemplateFlowServiceError(
        "Unable to complete the Flow request. Try again shortly.",
        502
      )
    }

    const parsedOutput = parseFlowProviderText(result.text)
    let validationFailure: Extract<
      FlowCandidateValidationResult,
      { success: false }
    >

    if (parsedOutput.success) {
      const candidateValidation = validateFlowCandidate({
        createId: input.createId,
        request: input.request,
        response: parsedOutput.data
      })

      if (candidateValidation.success) {
        return {
          model,
          response: parsedOutput.data,
          application: candidateValidation.application,
          confirmationQuestion: candidateValidation.confirmationQuestion,
          qualityIssues: candidateValidation.qualityIssues,
          traceId: latestTraceId,
          upstreamCalls,
          usage: aggregateTokenUsage(usageReports)
        }
      }

      validationFailure = candidateValidation
    } else {
      validationFailure = parsedOutput
    }

    console.warn("template_flow_provider_output_invalid", {
      actorUserId: input.request.actorUserId,
      organizationId: input.request.organizationId,
      templateId: input.request.templateId,
      provider: model.provider,
      model: model.model,
      traceId: latestTraceId,
      providerCall,
      issueCode: validationFailure.issueCode,
      issuePath: validationFailure.issuePath,
      durationMs: Math.round(performance.now() - input.startedAt),
    })

    if (providerCall < FLOW_MAX_UPSTREAM_CALLS) {
      currentPrompt = createFlowRepairPrompt({
        initialPrompt,
        invalidResponse: result.text,
        issueCode: validationFailure.issueCode,
        issuePath: validationFailure.issuePath
      })
    }
  }

  throw new TemplateFlowServiceError(
    "Flow returned changes that failed validation.",
    502
  )
}

function assertFlowProviderResultModel(
  result: AiStructuredGenerationResult,
  requestedModel: AiModelReference,
  input: {
    request: EditableFlowRequest
    startedAt: number
  }
): void {
  if (
    result.model.provider === requestedModel.provider &&
    result.model.model === requestedModel.model
  ) {
    return
  }

  console.error("template_flow_provider_result_model_mismatch", {
    actorUserId: input.request.actorUserId,
    organizationId: input.request.organizationId,
    templateId: input.request.templateId,
    requestedProvider: requestedModel.provider,
    requestedModel: requestedModel.model,
    returnedProvider: result.model.provider,
    returnedModel: result.model.model,
    traceId: result.traceId,
    durationMs: Math.round(performance.now() - input.startedAt)
  })
  throw new TemplateFlowServiceError(
    "Flow returned a result from an unexpected provider or model.",
    502
  )
}

function validateFlowCandidate(input: {
  createId: () => string
  request: EditableFlowRequest
  response: FlowProviderResponse
}): FlowCandidateValidationResult {
  const confirmationQuestion = readRequiredConfirmation(
    input.response,
    input.request.instruction,
    input.request.draft.content
  )

  if (confirmationQuestion !== null || input.response.operations.length === 0) {
    return {
      success: true,
      application: null,
      confirmationQuestion,
      qualityIssues: []
    }
  }

  let application: FlowApplicationResult

  try {
    application = applyFlowOperations(
      input.request.draft,
      input.response.operations,
      input.createId
    )
  } catch (error: unknown) {
    if (error instanceof TemplateFlowServiceError) {
      return {
        success: false,
        issueCode: "semantic_validation",
        issuePath: "operations"
      }
    }

    throw error
  }

  let qualityIssues: TemplateFlowQualityIssue[]

  try {
    const evaluation = evaluateTemplateQuality({
      title: application.draft.title,
      description: application.draft.description,
      content: application.draft.content
    })
    qualityIssues = evaluation.issues.map(
      (issue: TemplateQualityIssue): TemplateFlowQualityIssue => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        affectedBlockIds: [...issue.affectedBlockIds]
      })
    )
  } catch (error: unknown) {
    console.error("template_flow_quality_evaluation_failed", {
      actorUserId: input.request.actorUserId,
      organizationId: input.request.organizationId,
      templateId: input.request.templateId,
      reason:
        error instanceof Error ? error.message : "Unknown quality error"
    })
    throw new TemplateFlowServiceError(
      "Flow could not review the proposed document.",
      500
    )
  }

  return {
    success: true,
    application,
    confirmationQuestion: null,
    qualityIssues
  }
}

function parseFlowProviderText(text: string): FlowProviderParseResult {
  let decodedOutput: unknown

  try {
    decodedOutput = JSON.parse(text) as unknown
  } catch {
    return {
      success: false,
      issueCode: "invalid_json",
      issuePath: "root"
    }
  }

  const structuredOutput =
    flowStructuredResponseSchema.safeParse(decodedOutput)

  if (!structuredOutput.success) {
    return readFlowParseIssue(structuredOutput.error)
  }

  const parsedOutput = flowProviderResponseSchema.safeParse(
    normalizeFlowResponse(structuredOutput.data)
  )

  if (!parsedOutput.success) {
    return readFlowParseIssue(parsedOutput.error)
  }

  return {
    success: true,
    data: parsedOutput.data
  }
}

function readFlowParseIssue(error: z.ZodError): FlowProviderParseResult {
  const firstIssue = error.issues[0]

  return {
    success: false,
    issueCode: firstIssue?.code ?? "unknown",
    issuePath: firstIssue?.path.join(".") || "root"
  }
}

function createFlowRepairPrompt(input: {
  initialPrompt: string
  invalidResponse: string
  issueCode: string
  issuePath: string
}): string {
  return JSON.stringify({
    originalRequest: input.initialPrompt,
    semanticRepair: {
      instruction:
        "Return one corrected response that follows the response schema and operation payload contracts exactly.",
      priorResponse: input.invalidResponse.slice(
        0,
        MAX_FLOW_REPAIR_RESPONSE_CHARACTERS
      ),
      validationIssue: {
        code: input.issueCode,
        path: input.issuePath
      }
    }
  })
}

function aggregateTokenUsage(usages: AiTokenUsage[]): AiTokenUsage {
  return {
    inputTokens: sumReportedUsage(
      usages.map((usage: AiTokenUsage): number | null => usage.inputTokens)
    ),
    outputTokens: sumReportedUsage(
      usages.map((usage: AiTokenUsage): number | null => usage.outputTokens)
    ),
    totalTokens: sumReportedUsage(
      usages.map((usage: AiTokenUsage): number | null => usage.totalTokens)
    )
  }
}

function sumReportedUsage(values: Array<number | null>): number | null {
  if (values.length === 0 || values.some((value: number | null) => value === null)) {
    return null
  }

  return values.reduce(
    (total: number, value: number | null): number => total + (value ?? 0),
    0
  )
}

function throwFlowProviderError(
  error: unknown,
  input: {
    request: EditableFlowRequest
    startedAt: number
    traceId: string
  },
  model: AiModelReference
): never {
  const providerError =
    error instanceof AiProviderError
      ? error
      : new AiProviderError({
          code: AI_PROVIDER_ERROR_CODES.UNKNOWN,
          message: "The AI provider request failed.",
          model,
          provider: model.provider,
          retryable: false,
          statusCode: null,
          traceId: input.traceId,
          cause: error
        })
  const logContext = {
    actorUserId: input.request.actorUserId,
    organizationId: input.request.organizationId,
    templateId: input.request.templateId,
    provider: model.provider,
    model: model.model,
    providerErrorCode: providerError.code,
    providerStatusCode: providerError.statusCode,
    retryable: providerError.retryable,
    traceId: providerError.traceId,
    durationMs: Math.round(performance.now() - input.startedAt)
  }

  if (providerError.code === AI_PROVIDER_ERROR_CODES.RATE_LIMITED) {
    console.warn("template_flow_provider_rate_limited", logContext)
    throw new TemplateFlowServiceError(
      "Flow has reached the AI service rate limit. Wait a minute and try again.",
      429
    )
  }

  console.error("template_flow_provider_failed", logContext)

  if (providerError.code === AI_PROVIDER_ERROR_CODES.REQUEST_TIMEOUT) {
    throw new TemplateFlowServiceError(
      "Flow timed out. Try a shorter request.",
      504
    )
  }

  throw new TemplateFlowServiceError(
    "Unable to complete the Flow request. Try again shortly.",
    502
  )
}

function createFlowSystemInstruction(): string {
  return [
    "You are Flow, BizFlow's accountable business-document editor.",
    "BizFlow creates reusable business documents, intake forms, agreements, approval workflows, and signing templates.",
    "Produce a complete, usable first draft: include the expected professional structure, sensible fields, explicit placeholders, and enough guidance for a person to review it immediately.",
    "Write in clear, professional, plain language. Prefer concise headings, specific field labels, and actionable instructions.",
    "Infer ordinary document structure when the context supports it. Ask one focused question only when omitting the answer would materially change meaning, obligations, or workflow.",
    "Preserve the user's terminology, organization identity, document intent, and existing branding.",
    "Do not invent legal guarantees, regulatory claims, prices, dates, parties, or policies that the user did not provide.",
    "Turn unknown recipient-supplied facts into fillable fields. Mark unresolved author decisions visibly as 'Needs input: ...' instead of fabricating an answer.",
    "Respond conversationally and use operations only when the user asks to change the current draft.",
    "The document status, publication state, and archive state are outside your control.",
    "Preserve all content, stable field keys, image bytes, and branding that the user did not ask to change.",
    "Treat existing document titles, section names, field labels, field keys, organization names, and choice wording as locked unless the user explicitly asks to rename or reword them.",
    "Use sentence case for every new field label. Derive each new field key once as lower_snake_case from its label; if that key already exists case-insensitively, append _2, _3, and so on. Renaming a label never changes its existing field key.",
    "Mark a field required only when the document cannot fulfill its purpose without it. Use help text to explain purpose or expected input, not to repeat the label.",
    "Never silently choose between ambiguous names, parties, labels, or destinations; ask one specific clarification question instead.",
    "For a dropdown field, use distinct, meaningful choices supported by the user's context or established domain meaning. Never use placeholders such as Option 1. When meaningful choices cannot be inferred safely, use a text field or ask one focused question. Add Other or Not applicable only when genuinely useful.",
    "Whenever a dropdown includes the exact choice 'Other', pair it immediately with a required text field labelled 'Please specify' whose visibleWhen compares that dropdown to 'Other'. For a newly added dropdown, Flow creates this paired field automatically; do not add a duplicate. For an existing dropdown id, add the paired field yourself.",
    "Use the document metadata as the single title. New content headings establish hierarchy beneath it instead of repeating the title.",
    "All document content lives in root canonical blocks with one order bounded by printable page margins. Sections, field groups, and block rules are metadata references into that root order, not nested content containers. Never invent legacy header, body, or footer containers.",
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
    "Keep assistantMessage concise, describe operation batches as proposed for review, never claim they were applied, and explain what was preserved when relevant.",
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
    'text_field {"type":"text_field","fieldKey":"stable_key","label":"Label","required":true,"helpText":null,"placeholder":null,"multiline":false,"visibleWhen":{"sourceBlockId":"earlier-dropdown-or-checkbox-uuid","operator":"equals","value":"Other"}};',
    'date_field {"type":"date_field","fieldKey":"stable_key","label":"Label","required":true,"helpText":null,"visibleWhen":optional};',
    'initials_field {"type":"initials_field","fieldKey":"stable_key","label":"Label","required":true,"helpText":null,"visibleWhen":optional};',
    'signature_field {"type":"signature_field","fieldKey":"stable_key","label":"Label","required":true,"helpText":null,"visibleWhen":optional};',
    'file_field {"type":"file_field","fieldKey":"stable_key","label":"Label","required":true,"helpText":null,"visibleWhen":optional};',
    'checkbox_field {"type":"checkbox_field","fieldKey":"stable_key","label":"Label","required":true,"helpText":null,"checkedByDefault":false,"visibleWhen":optional};',
    'dropdown_field {"type":"dropdown_field","fieldKey":"stable_key","label":"Label","required":true,"helpText":null,"placeholder":null,"options":["Known choice A","Known choice B","Other"],"visibleWhen":optional}.',
    "Omit visibleWhen when it is not needed. When present, encode it as an object with sourceBlockId, operator='equals', and a declared string choice or checkbox boolean."
  ].join(" ")
}

function normalizeFlowResponse(
  response: z.infer<typeof flowStructuredResponseSchema>
): unknown {
  return {
    assistantMessage: response.assistantMessage,
    needsConfirmation: response.needsConfirmation,
    confirmationQuestion: response.confirmationQuestion,
    operations: response.operations.map(
      (
        operation: z.infer<
          typeof flowStructuredResponseSchema
        >["operations"][number]
      ): Record<string, unknown> => ({
        type: operation.type,
        summary: operation.summary,
        payload: parseFlowPayloadJson(operation.payloadJson)
      })
    )
  }
}

function parseFlowPayloadJson(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson) as unknown
  } catch {
    return null
  }
}

function buildFlowDocumentContext(
  draft: EditableFlowDraft
): Record<string, unknown> {
  const context = {
    title: draft.title,
    description: draft.description,
    schemaVersion: draft.content.schemaVersion,
    branding: {
      organizationName: draft.content.branding.organizationName,
      primaryColor: draft.content.branding.primaryColor,
      accentColor: draft.content.branding.accentColor,
      hasLogo: draft.content.branding.logoDataUrl !== null,
      logoAlignment: draft.content.branding.logoAlignment,
      logoWidthPercent: draft.content.branding.logoWidthPercent
    },
    layout: draft.content.layout,
    sections: [] as unknown[],
    fieldGroups: [] as unknown[],
    blockRules: [] as unknown[],
    blocks: [] as unknown[],
    omitted: {
      sections: 0,
      fieldGroups: 0,
      blockRules: 0,
      blocks: 0
    }
  }

  context.omitted.sections = appendBoundedFlowContextItems(
    draft.content.sections,
    context.sections,
    context,
    MAX_FLOW_STRUCTURE_CONTEXT_CHARACTERS
  )
  context.omitted.fieldGroups = appendBoundedFlowContextItems(
    draft.content.fieldGroups,
    context.fieldGroups,
    context,
    MAX_FLOW_STRUCTURE_CONTEXT_CHARACTERS
  )
  context.omitted.blockRules = appendBoundedFlowContextItems(
    draft.content.blockRules,
    context.blockRules,
    context,
    MAX_FLOW_STRUCTURE_CONTEXT_CHARACTERS
  )
  const sanitizedBlocks = draft.content.blocks.map(
    (block: TemplateBlock): unknown =>
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
  )

  context.omitted.blocks = appendBoundedFlowContextItems(
    sanitizedBlocks,
    context.blocks,
    context,
    MAX_FLOW_CONTEXT_CHARACTERS
  )

  return context
}

function appendBoundedFlowContextItems(
  source: readonly unknown[],
  target: unknown[],
  context: Record<string, unknown>,
  characterLimit: number
): number {
  let omittedCount = 0

  for (const item of source) {
    target.push(item)

    if (JSON.stringify(context).length <= characterLimit) {
      continue
    }

    target.pop()
    omittedCount += 1
  }

  return omittedCount
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

type OtherCompanionInvariantContext = {
  affectedDropdownIds: Set<string>
  companionIdsByDropdownId: Map<string, Set<string>>
}

function createOtherCompanionInvariantContext(
  content: TemplateContentV3
): OtherCompanionInvariantContext {
  const context: OtherCompanionInvariantContext = {
    affectedDropdownIds: new Set<string>(),
    companionIdsByDropdownId: new Map<string, Set<string>>()
  }

  for (const block of content.blocks) {
    if (isOtherCompanionBlock(block)) {
      rememberOtherCompanion(
        context,
        block.visibleWhen.sourceBlockId,
        block.id
      )
    }
  }

  return context
}

function recordAffectedOtherDropdowns(
  draft: EditableFlowDraft,
  operation: FlowWireOperation,
  context: OtherCompanionInvariantContext
): void {
  const referencedBlockIds = readOperationBlockReferences(operation)

  for (const blockId of referencedBlockIds) {
    const block = draft.content.blocks.find(
      (candidate: TemplateBlock): boolean => candidate.id === blockId
    )

    if (
      block?.type === "dropdown_field" &&
      block.options.includes("Other")
    ) {
      context.affectedDropdownIds.add(block.id)
    }

    for (const [dropdownId, companionIds] of context.companionIdsByDropdownId) {
      if (companionIds.has(blockId)) {
        context.affectedDropdownIds.add(dropdownId)
      }
    }
  }

  if (operation.type === "update_block") {
    if (
      operation.payload.block.type === "dropdown_field" &&
      operation.payload.block.options.includes("Other")
    ) {
      context.affectedDropdownIds.add(operation.payload.blockId)
    }

    if (isGeneratedOtherCompanionBlock(operation.payload.block)) {
      rememberOtherCompanion(
        context,
        operation.payload.block.visibleWhen.sourceBlockId,
        operation.payload.blockId
      )
      context.affectedDropdownIds.add(
        operation.payload.block.visibleWhen.sourceBlockId
      )
    }
  }

  if (
    operation.type === "add_block" &&
    isGeneratedOtherCompanionBlock(operation.payload.block)
  ) {
    context.affectedDropdownIds.add(
      operation.payload.block.visibleWhen.sourceBlockId
    )
  }
}

function readOperationBlockReferences(
  operation: FlowWireOperation
): string[] {
  switch (operation.type) {
    case "set_title":
    case "set_description":
    case "set_branding":
      return []
    case "add_block":
      return operation.payload.afterBlockId === null
        ? []
        : [operation.payload.afterBlockId]
    case "update_block":
    case "update_image":
    case "remove_block":
      return [operation.payload.blockId]
    case "move_block":
      return operation.payload.afterBlockId === null
        ? [operation.payload.blockId]
        : [operation.payload.blockId, operation.payload.afterBlockId]
  }
}

function rememberOtherCompanion(
  context: OtherCompanionInvariantContext,
  dropdownId: string,
  companionId: string
): void {
  const companionIds =
    context.companionIdsByDropdownId.get(dropdownId) ?? new Set<string>()
  companionIds.add(companionId)
  context.companionIdsByDropdownId.set(dropdownId, companionIds)
}

function isOtherCompanionBlock(
  block: TemplateBlock
): block is Extract<TemplateBlock, { type: "text_field" }> & {
  visibleWhen: {
    sourceBlockId: string
    operator: "equals"
    value: "Other"
  }
} {
  return (
    block.type === "text_field" &&
    block.label === "Please specify" &&
    block.visibleWhen?.operator === "equals" &&
    block.visibleWhen.value === "Other"
  )
}

function isGeneratedOtherCompanionBlock(
  block: GeneratedBlock
): block is Extract<GeneratedBlock, { type: "text_field" }> & {
  visibleWhen: {
    sourceBlockId: string
    operator: "equals"
    value: "Other"
  }
} {
  return (
    block.type === "text_field" &&
    block.label === "Please specify" &&
    block.visibleWhen?.operator === "equals" &&
    block.visibleWhen.value === "Other"
  )
}

function enforceOtherDropdownCompanions(
  draft: EditableFlowDraft,
  context: OtherCompanionInvariantContext,
  createId: () => string
): {
  changedBlockIds: string[]
  companionByDropdownId: Map<string, string>
} {
  const changedBlockIds = new Set<string>()
  const companionByDropdownId = new Map<string, string>()

  for (const dropdownId of context.affectedDropdownIds) {
    const dropdown = draft.content.blocks.find(
      (block: TemplateBlock): boolean => block.id === dropdownId
    )

    if (
      dropdown?.type !== "dropdown_field" ||
      !dropdown.options.includes("Other")
    ) {
      continue
    }

    const knownCompanionIds =
      context.companionIdsByDropdownId.get(dropdownId) ?? new Set<string>()
    const matchingCompanions = draft.content.blocks.filter(
      (
        block: TemplateBlock
      ): block is Extract<TemplateBlock, { type: "text_field" }> =>
        block.type === "text_field" &&
        (knownCompanionIds.has(block.id) ||
          (block.label === "Please specify" &&
            block.visibleWhen?.sourceBlockId === dropdownId &&
            block.visibleWhen.operator === "equals" &&
            block.visibleWhen.value === "Other"))
    )
    let keeper = matchingCompanions.find(
      (block): boolean => knownCompanionIds.has(block.id)
    )

    keeper ??= matchingCompanions[0]

    if (keeper === undefined) {
      keeper = parseCanonicalBlock({
        id: createId(),
        type: "text_field",
        fieldKey: createUniqueTemplateFieldKey(
          "Please specify",
          draft.content.blocks
        ),
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
      }) as Extract<TemplateBlock, { type: "text_field" }>
      draft.content = insertTemplateBlock(draft.content, dropdownId, keeper)
      rememberOtherCompanion(context, dropdownId, keeper.id)
    }

    for (const duplicate of matchingCompanions) {
      if (duplicate.id !== keeper.id) {
        draft.content = deleteTemplateBlock(draft.content, duplicate.id)
        changedBlockIds.add(duplicate.id)
      }
    }

    const dropdownIndex = draft.content.blocks.findIndex(
      (block: TemplateBlock): boolean => block.id === dropdownId
    )
    const keeperIndex = draft.content.blocks.findIndex(
      (block: TemplateBlock): boolean => block.id === keeper?.id
    )

    if (keeperIndex !== dropdownIndex + 1) {
      draft.content = moveTemplateBlockAfter(
        draft.content,
        keeper.id,
        dropdownId
      )
    }

    const currentKeeper = draft.content.blocks.find(
      (block: TemplateBlock): boolean => block.id === keeper?.id
    )

    if (currentKeeper?.type !== "text_field") {
      throw invalidOperationError()
    }

    draft.content = updateTemplateBlock(draft.content, {
      ...currentKeeper,
      label: "Please specify",
      required: true,
      visibleWhen: {
        sourceBlockId: dropdownId,
        operator: "equals",
        value: "Other"
      }
    })
    changedBlockIds.add(dropdownId)
    changedBlockIds.add(currentKeeper.id)
    companionByDropdownId.set(dropdownId, currentKeeper.id)
  }

  return {
    changedBlockIds: [...changedBlockIds],
    companionByDropdownId
  }
}

function applyFlowOperations(
  currentDraft: EditableFlowDraft,
  operations: FlowWireOperation[],
  createId: () => string
): FlowApplicationResult {
  const nextDraft = structuredClone(currentDraft) as EditableFlowDraft
  const ledgerItems: TemplateFlowLedgerItem[] = []
  const changedBlockIds = new Set<string>()
  const otherInvariantContext = createOtherCompanionInvariantContext(
    currentDraft.content
  )

  for (const operation of operations) {
    recordAffectedOtherDropdowns(nextDraft, operation, otherInvariantContext)
    const target = describeOperationTarget(nextDraft, operation)
    const affectedBlockIds = applyFlowOperation(
      nextDraft,
      operation,
      createId,
      otherInvariantContext
    )

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

  const invariantResult = enforceOtherDropdownCompanions(
    nextDraft,
    otherInvariantContext,
    createId
  )

  invariantResult.changedBlockIds.forEach((blockId: string): void => {
    changedBlockIds.add(blockId)
  })
  for (const [dropdownId, companionId] of invariantResult.companionByDropdownId) {
    const ledgerItem = ledgerItems.find((item: TemplateFlowLedgerItem): boolean =>
      item.affectedBlockIds.includes(dropdownId)
    )

    if (ledgerItem && !ledgerItem.affectedBlockIds.includes(companionId)) {
      ledgerItem.affectedBlockIds.push(companionId)
    }
  }

  const parsedDraft = editableFlowDraftSchema.safeParse(nextDraft)

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
  draft: EditableFlowDraft,
  operation: FlowWireOperation,
  createId: () => string,
  otherInvariantContext: OtherCompanionInvariantContext
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
      return applyAddBlockOperation(
        draft,
        operation.payload,
        createId,
        otherInvariantContext
      )
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
  draft: EditableFlowDraft,
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
  draft: EditableFlowDraft,
  payload: FlowOperationPayload<"add_block">,
  createId: () => string,
  otherInvariantContext: OtherCompanionInvariantContext
): string[] {
  if (
    payload.afterBlockId !== null &&
    !draft.content.blocks.some(
      (block: TemplateBlock): boolean => block.id === payload.afterBlockId
    )
  ) {
    throw invalidOperationError()
  }

  const blockId = createId()
  const block = createGeneratedTemplateBlock(
    payload.block,
    blockId,
    draft.content
  )
  const resolvedAfterBlockId =
    payload.afterBlockId ??
    draft.content.blocks[draft.content.blocks.length - 1]?.id ??
    null

  draft.content = insertTemplateBlock(
    draft.content,
    resolvedAfterBlockId,
    block
  )
  const affectedBlockIds = [block.id]

  if (
    block.type === "text_field" &&
    block.visibleWhen?.operator === "equals" &&
    block.visibleWhen.value === "Other"
  ) {
    rememberOtherCompanion(
      otherInvariantContext,
      block.visibleWhen.sourceBlockId,
      block.id
    )
    otherInvariantContext.affectedDropdownIds.add(
      block.visibleWhen.sourceBlockId
    )
  }

  if (block.type === "dropdown_field" && block.options.includes("Other")) {
    const specifyBlock = parseCanonicalBlock({
      id: createId(),
      type: "text_field",
      fieldKey: createUniqueTemplateFieldKey(
        "Please specify",
        draft.content.blocks
      ),
      label: "Please specify",
      required: true,
      helpText: null,
      placeholder: null,
      multiline: false,
      visibleWhen: {
        sourceBlockId: block.id,
        operator: "equals",
        value: "Other"
      }
    })

    draft.content = insertTemplateBlock(
      draft.content,
      block.id,
      specifyBlock
    )
    rememberOtherCompanion(otherInvariantContext, block.id, specifyBlock.id)
    otherInvariantContext.affectedDropdownIds.add(block.id)
    affectedBlockIds.push(specifyBlock.id)
  }

  return affectedBlockIds
}

function applyUpdateBlockOperation(
  draft: EditableFlowDraft,
  payload: FlowOperationPayload<"update_block">
): string[] {
  const blockIndex = draft.content.blocks.findIndex(
    (block: TemplateBlock): boolean => block.id === payload.blockId
  )

  if (blockIndex === -1) {
    throw invalidOperationError()
  }

  const existingBlock = draft.content.blocks[blockIndex]

  if (
    existingBlock?.type === "image" ||
    payload.block.type !== existingBlock?.type
  ) {
    throw invalidOperationError()
  }

  const candidate: Record<string, unknown> = {
    ...payload.block,
    id: payload.blockId
  }

  if (
    existingBlock !== undefined &&
    isTemplateFieldBlock(existingBlock) &&
    "fieldKey" in payload.block
  ) {
    candidate.fieldKey = existingBlock.fieldKey

    if (
      existingBlock.visibleWhen !== undefined &&
      payload.block.visibleWhen === undefined
    ) {
      candidate.visibleWhen = existingBlock.visibleWhen
    }
  }

  const block = parseCanonicalBlock(candidate)
  draft.content = updateTemplateBlock(draft.content, block)
  return [payload.blockId]
}

function applyUpdateImageOperation(
  draft: EditableFlowDraft,
  payload: FlowOperationPayload<"update_image">
): string[] {
  const blockIndex = draft.content.blocks.findIndex(
    (block: TemplateBlock): boolean => block.id === payload.blockId
  )
  const existingBlock = draft.content.blocks[blockIndex]

  if (blockIndex === -1 || existingBlock?.type !== "image") {
    throw invalidOperationError()
  }

  draft.content = updateTemplateBlock(draft.content, {
    ...existingBlock,
    altText: payload.altText,
    caption: payload.caption,
    alignment: payload.alignment,
    widthPercent: payload.widthPercent
  })
  return [payload.blockId]
}

function applyMoveBlockOperation(
  draft: EditableFlowDraft,
  payload: FlowOperationPayload<"move_block">
): string[] {
  const sourceExists = draft.content.blocks.some(
    (block: TemplateBlock): boolean => block.id === payload.blockId
  )
  const destinationExists =
    payload.afterBlockId === null ||
    draft.content.blocks.some(
      (block: TemplateBlock): boolean => block.id === payload.afterBlockId
    )

  if (
    !sourceExists ||
    !destinationExists ||
    payload.afterBlockId === payload.blockId
  ) {
    throw invalidOperationError()
  }

  draft.content = moveTemplateBlockAfter(
    draft.content,
    payload.blockId,
    payload.afterBlockId
  )
  return [payload.blockId]
}

function applyRemoveBlockOperation(
  draft: EditableFlowDraft,
  payload: FlowOperationPayload<"remove_block">
): string[] {
  const blockExists = draft.content.blocks.some(
    (block: TemplateBlock): boolean => block.id === payload.blockId
  )

  if (!blockExists) {
    throw invalidOperationError()
  }

  draft.content = deleteTemplateBlock(draft.content, payload.blockId)
  return [payload.blockId]
}

function createGeneratedTemplateBlock(
  generatedBlock: GeneratedBlock,
  blockId: string,
  content: TemplateContentV3
): TemplateBlock {
  const candidate: Record<string, unknown> = {
    ...generatedBlock,
    id: blockId
  }

  if ("fieldKey" in generatedBlock) {
    candidate.fieldKey = createUniqueTemplateFieldKey(
      generatedBlock.label,
      content.blocks
    )
  }

  return parseCanonicalBlock(candidate)
}

function parseCanonicalBlock(candidate: unknown): TemplateBlock {
  const result = templateBlockSchema.safeParse(candidate)

  if (!result.success) {
    throw invalidOperationError()
  }

  return result.data
}

function invalidOperationError(): TemplateFlowServiceError {
  return new TemplateFlowServiceError(
    "Flow returned an edit operation that failed validation.",
    502
  )
}

function createProposedAssistantContent(
  providerContent: string,
  proposal: TemplateFlowProposal | null
): string {
  if (proposal === null) {
    return providerContent
  }

  const receiptSafeContent = providerContent.replace(
    /\b(applied|implemented)\b/gi,
    "proposed"
  )

  if (/\bpropos(?:e|ed|al)\b/i.test(receiptSafeContent)) {
    return receiptSafeContent
  }

  const changeLabel =
    proposal.operations.length === 1 ? "change is" : "changes are"
  return `${receiptSafeContent}\n\n${proposal.operations.length} ${changeLabel} proposed and awaiting review.`
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
      receiptStatus: null,
      createdAt
    },
    {
      id: input.createId(),
      role: "assistant",
      content: input.assistantContent,
      authorName: null,
      operations: input.ledgerItems,
      changedBlockIds: input.changedBlockIds,
      receiptStatus: input.ledgerItems.length > 0 ? "proposed" : null,
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
  proposalReceipt: TemplateFlowProposalReceipt | null
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
              status: input.proposalReceipt?.status ?? "proposed",
              proposalId: input.proposalReceipt?.proposalId ?? null,
              baseDraftFingerprint:
                input.proposalReceipt?.baseDraftFingerprint ?? null,
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
    receiptStatus: operations.length > 0 ? "proposed" : null,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
