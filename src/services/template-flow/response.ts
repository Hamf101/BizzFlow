import { z } from "zod"

import {
  type AiModelReference,
  type AiStructuredGenerationResult,
  type AiTokenUsage,
} from "@/services/ai/contracts"
import {
  AI_PROVIDER_ERROR_CODES,
  AiProviderError
} from "@/services/ai/errors"
import {
  evaluateTemplateQuality,
  type TemplateQualityIssue
} from "@/services/templates/template-quality-service"
import type { TemplateFlowDraft, TemplateFlowQualityIssue } from "@/types/template-flow"
import {
  type EditableFlowRequest,
  FLOW_UNREVISABLE_ISSUE_CODES,
  type FlowApplicationResult,
  type FlowCandidateValidationResult,
  type FlowProviderParseResult,
  type FlowProviderResponse,
  type FlowProviderResult,
  type FlowSubject,
  TemplateFlowServiceError,
  flowProviderResponseSchema,
  flowStructuredResponseSchema,
} from "@/services/template-flow/contracts"
import {
  FlowOperationError,
  applyFlowOperations,
  describeZodIssues,
} from "@/services/template-flow/operations"
import { isRecord } from "@/services/template-flow/persistence"

export function assertFlowProviderResultModel(
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

export function validateFlowCandidate(input: {
  createId: () => string
  request: FlowSubject
  response: Pick<FlowProviderResponse, "confirmationQuestion" | "needsConfirmation" | "operations">
}): FlowCandidateValidationResult {
  // Only the model asks before a change. A removal it makes is shown on the
  // proposal as its own change, for the user to keep or drop.
  const confirmationQuestion = input.response.needsConfirmation
    ? input.response.confirmationQuestion || "Before I make that change, which content should be removed?"
    : null

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
        issuePath: "operations",
        detail: error instanceof FlowOperationError ? error.detail : undefined
      }
    }

    throw error
  }

  let qualityIssues: TemplateFlowQualityIssue[]

  try {
    qualityIssues = evaluateFlowDraft(application.draft)
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

// ponytail: no page-fit check. The planner now fits or splits every block the
// schema allows (probed with the largest tables, lists and boxes), so there is
// no overflow left to find; add one here if a block type that can overflow arrives.
function evaluateFlowDraft(draft: TemplateFlowDraft): TemplateFlowQualityIssue[] {
  return evaluateTemplateQuality(draft).issues.map(
    (issue: TemplateQualityIssue): TemplateFlowQualityIssue => ({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      affectedBlockIds: [...issue.affectedBlockIds]
    })
  )
}

// The faults this turn brought in and a rewrite could put right. What the
// document already had stays the author's: Flow was not asked to touch it.
export function readRevisableFaults(base: TemplateFlowDraft, candidate: FlowProviderResult): TemplateFlowQualityIssue[] {
  const fixable = candidate.qualityIssues.filter(
    (issue: TemplateFlowQualityIssue) => !FLOW_UNREVISABLE_ISSUE_CODES.has(issue.code)
  )

  if (candidate.application === null || fixable.length === 0) {
    return []
  }

  const before = new Map(
    evaluateFlowDraft(base).map((issue: TemplateFlowQualityIssue) => [issue.code, new Set(issue.affectedBlockIds)])
  )

  return fixable.filter((issue: TemplateFlowQualityIssue) => {
    const known = before.get(issue.code)

    return known === undefined || issue.affectedBlockIds.some((blockId: string) => !known.has(blockId))
  })
}

// A fault on three blocks is three things to put right.
export function weighFaults(faults: TemplateFlowQualityIssue[]): number {
  return faults.reduce((sum: number, fault: TemplateFlowQualityIssue) => sum + Math.max(1, fault.affectedBlockIds.length), 0)
}

export function parseFlowProviderText(
  text: string,
  createId: () => string
): FlowProviderParseResult {
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

  const normalized = normalizeFlowResponse(structuredOutput.data)
  const refIssue = resolveFlowRefs(normalized.operations, createId)

  if (refIssue !== null) {
    return {
      success: false,
      issueCode: "unknown_ref",
      issuePath: "operations",
      detail: refIssue
    }
  }

  const parsedOutput = flowProviderResponseSchema.safeParse(normalized)

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
    issuePath: firstIssue?.path.join(".") || "root",
    detail: describeZodIssues(error)
  }
}

export function aggregateTokenUsage(usages: AiTokenUsage[]): AiTokenUsage {
  return {
    cachedTokens: sumReportedUsage(
      usages.map((usage: AiTokenUsage): number | null => usage.cachedTokens ?? null)
    ),
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

export function throwFlowProviderError(
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

  console.error("template_flow_provider_failed", JSON.stringify(logContext))

  if (providerError.code === AI_PROVIDER_ERROR_CODES.UPSTREAM_UNAVAILABLE) {
    throw new TemplateFlowServiceError(
      "Flow's AI service is temporarily unavailable. Your document is unchanged. Try sending your message again shortly.",
      503
    )
  }

  if (providerError.code === AI_PROVIDER_ERROR_CODES.REQUEST_TIMEOUT) {
    throw new TemplateFlowServiceError(
      "Flow took too long to answer. Try again.",
      504
    )
  }

  throw new TemplateFlowServiceError(
    "Unable to complete the Flow request. Try again shortly.",
    502
  )
}

function normalizeFlowResponse(
  response: z.infer<typeof flowStructuredResponseSchema>
): Record<string, unknown> & { operations: DecodedFlowOperation[] } {
  return {
    assistantMessage: response.assistantMessage,
    needsConfirmation: response.needsConfirmation,
    confirmationQuestion: response.confirmationQuestion,
    operations: response.operations.map(
      (
        operation: z.infer<
          typeof flowStructuredResponseSchema
        >["operations"][number]
      ): DecodedFlowOperation => ({
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

type DecodedFlowOperation = { type: string; summary: string; payload: unknown }

// The name a response gives a block it adds, to use as that block's id in its later operations.
// Any short name: models write "new:1", "new:signature" and "b_owner" alike.
const FLOW_REF_PATTERN = /^[\w:.-]{1,40}$/

// A real block id. Where an operation names a block, anything else is read as a ref.
const FLOW_BLOCK_ID_PATTERN = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

// Where an operation names a block.
const FLOW_REF_KEYS = new Set(["afterBlockId", "blockId", "blockIds", "sourceBlockId"])

// A payload names blocks no deeper than block.visibleWhen.sourceBlockId; nothing past this is read.
const FLOW_REF_DEPTH = 4

/**
 * Gives each block a response adds under a ref its id, and puts that id
 * wherever a later operation uses the ref, so one turn can add a field and
 * then place it, or make another field depend on it.
 *
 * @param operations - The response's operations, their payloads decoded but not yet checked.
 * @param createId - Makes the new blocks' ids.
 * @returns What is wrong with a ref, for the model's correction, or null.
 */
function resolveFlowRefs(
  operations: DecodedFlowOperation[],
  createId: () => string
): string | null {
  const ids = new Map<string, string>()

  for (const [index, operation] of operations.entries()) {
    const unknown = replaceFlowRefs(operation.payload, ids, 0)

    if (unknown !== null) {
      return `operations[${index}] ${operation.type}: ${JSON.stringify(unknown).slice(0, 40)} is neither a block id nor the ref of a block added earlier in this response`
    }

    if (operation.type !== "add_block" || !isRecord(operation.payload)) {
      continue
    }

    const { ref } = operation.payload

    delete operation.payload.ref
    delete operation.payload.id

    if (ref === undefined) {
      continue
    }

    if (typeof ref !== "string" || !FLOW_REF_PATTERN.test(ref) || FLOW_BLOCK_ID_PATTERN.test(ref) || ids.has(ref)) {
      return `operations[${index}] add_block: ref ${JSON.stringify(ref).slice(0, 40)} must be a short name such as "new:1", and no two blocks may share one`
    }

    ids.set(ref, createId())
    operation.payload.id = ids.get(ref)
  }

  return null
}

// Swaps refs for ids in place, and returns the first ref that names nothing.
function replaceFlowRefs(
  node: unknown,
  ids: ReadonlyMap<string, string>,
  depth: number
): string | null {
  if (!isRecord(node) || depth > FLOW_REF_DEPTH) {
    return null
  }

  for (const [key, value] of Object.entries(node)) {
    if (!FLOW_REF_KEYS.has(key)) {
      const unknown = replaceFlowRefs(value, ids, depth + 1)

      if (unknown !== null) {
        return unknown
      }

      continue
    }

    const named = Array.isArray(value) ? value : [value]
    const resolved = named.map((entry: unknown): unknown =>
      typeof entry === "string" ? (ids.get(entry) ?? entry) : entry
    )
    const unknown = resolved.find(
      (entry: unknown): entry is string =>
        typeof entry === "string" && !FLOW_BLOCK_ID_PATTERN.test(entry)
    )

    if (unknown !== undefined) {
      return unknown
    }

    node[key] = Array.isArray(value) ? resolved : resolved[0]
  }

  return null
}
