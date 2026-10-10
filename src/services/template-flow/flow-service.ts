import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"

import { z } from "zod"

import {
  type AiRuntime,
  type AiStructuredGenerationResult,
  type AiTokenUsage,
} from "@/services/ai/contracts"
import {
  AI_PROVIDER_ERROR_CODES,
  AiProviderError
} from "@/services/ai/errors"
import { createAiRuntime } from "@/services/ai/provider-factory"
import {
  DocumentSigningServiceError,
  getGeneratedDocumentSigningView
} from "@/services/document-signing-service"
import { createTemplateFlowDraftFingerprint } from "@/services/template-flow-proposal-state"
import { createTemplateFlowResponseSchema } from "@/services/template-ai/flow-response-schema"
import { upgradeV2TemplateContentToV3 } from "@/types/template"
import type {
  TemplateFlowDraft,
  TemplateFlowMessage,
  TemplateFlowProposal,
  TemplateFlowQualityIssue,
  TemplateFlowResult,
} from "@/types/template-flow"
import {
  type DocumentFlowServiceDeps,
  type EditableFlowRequest,
  type ExecuteDocumentFlowInput,
  type ExecuteTemplateFlowInput,
  FLOW_MAX_OUTPUT_TOKENS,
  FLOW_MAX_UPSTREAM_CALLS,
  FLOW_REVISE_DEADLINE_MS,
  type FlowApplicationResult,
  type FlowCandidateValidationResult,
  type FlowProviderResult,
  type FlowSubject,
  type FlowWireOperation,
  type ListTemplateFlowMessagesInput,
  MAX_FLOW_HISTORY_MESSAGES,
  type RebuildDocumentFlowProposalInput,
  type RebuildTemplateFlowProposalInput,
  type TemplateFlowServiceDeps,
  TemplateFlowServiceError,
  flowRebuildRequestSchema,
  flowRequestSchema,
} from "@/services/template-flow/contracts"
import {
  createFlowMessages,
  createProposedAssistantContent,
  loadFlowHistory,
  persistFlowMessages,
  requireTemplateManagement,
  resolveFlowAuthorName,
} from "@/services/template-flow/persistence"
import {
  buildFlowDocumentContext,
  createFlowRepairPrompt,
  createFlowRevisePrompt,
  createFlowSystemInstruction,
} from "@/services/template-flow/prompt"
import {
  aggregateTokenUsage,
  assertFlowProviderResultModel,
  parseFlowProviderText,
  readRevisableFaults,
  throwFlowProviderError,
  validateFlowCandidate,
  weighFaults,
} from "@/services/template-flow/response"

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
    (deps.loadHistory ?? ((history) => loadFlowHistory(history, deps.client)))({
      organizationId: request.organizationId,
      templateId: request.templateId
    }),
    (deps.resolveAuthorName ?? ((actorUserId) => resolveFlowAuthorName(actorUserId, deps.client)))(request.actorUserId)
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
      : createFlowProposal({
          application,
          baseDraftFingerprint,
          createId,
          qualityIssues: providerResult.qualityIssues,
          wireOperations: providerResponse.operations
        })
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
    await (deps.persistMessages ?? ((turn) => persistFlowMessages(turn, deps.client)))({
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
    cachedTokens: providerResult.usage.cachedTokens ?? null,
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
 * Completes one Flow turn about a generated document's own page. It is the
 * same Flow that edits templates, open to anyone who may open the document;
 * applying a suggestion goes through the document's own save, which keeps the
 * draft-only and edit-access rules.
 *
 * @param input - Actor, tenant, document, the page the editor holds, and the message.
 * @param deps - Optional document authorization and the template Flow dependencies.
 * @returns A staged candidate batch and the turn's messages.
 * @throws TemplateFlowServiceError when the document cannot be opened or Flow fails.
 */
export async function executeDocumentFlow(
  input: ExecuteDocumentFlowInput,
  deps: DocumentFlowServiceDeps = {}
): Promise<TemplateFlowResult> {
  const { actorUserId, documentId, organizationId } = input

  await authorizeDocumentFlow(input, deps)

  // Flow keys a turn by what it edits, so the document's id rides in
  // `templateId`. ponytail: the conversation lives in the editor's tab; keep
  // it per document once someone needs it back after a reload.
  return executeTemplateFlow(
    { actorUserId, draft: input.draft, instruction: input.instruction, model: input.model, organizationId, templateId: documentId },
    {
      ...deps,
      authorizeTemplateManagement: async (): Promise<void> => {},
      loadHistory: async (): Promise<TemplateFlowMessage[]> => [],
      persistMessages: async (): Promise<void> => {}
    }
  )
}

/**
 * Rebuilds a pending proposal from the changes its reviewer kept, without
 * asking the model again: the same applier and checks a Flow turn runs, on
 * the draft the proposal was made from. The changes are checked as strictly
 * as a fresh Flow response's.
 *
 * @param input - Actor, tenant, template, the base draft, its fingerprint, and the kept changes.
 * @param deps - Optional authorization and id adapters.
 * @returns A fresh pending proposal holding only the kept changes.
 * @throws TemplateFlowServiceError: 400 for changes Flow could not have made,
 *   409 when the draft moved on, 422 when a kept change needs a dropped one.
 */
export async function rebuildTemplateFlowProposal(
  input: RebuildTemplateFlowProposalInput,
  deps: TemplateFlowServiceDeps = {}
): Promise<TemplateFlowProposal> {
  const startedAt = performance.now()
  const parsedInput = flowRebuildRequestSchema.safeParse(input)

  if (!parsedInput.success) {
    throw new TemplateFlowServiceError("Flow could not read these changes.", 400)
  }

  const { baseDraftFingerprint, operations, ...subject } = parsedInput.data
  const request: FlowSubject = {
    ...subject,
    draft: { ...subject.draft, content: upgradeV2TemplateContentToV3(subject.draft.content) }
  }

  await authorizeFlowRequest(request, deps, startedAt)

  // The same raw fingerprint a turn takes, so an unchanged draft matches.
  if (createTemplateFlowDraftFingerprint(input.draft as TemplateFlowDraft) !== baseDraftFingerprint) {
    throw new TemplateFlowServiceError(
      "The draft changed since Flow proposed this. Reject it and ask Flow again.",
      409
    )
  }

  const createId = deps.createId ?? randomUUID
  const validation = validateFlowCandidate({
    createId,
    request,
    response: { confirmationQuestion: "", needsConfirmation: false, operations }
  })

  if (!validation.success) {
    throw new TemplateFlowServiceError(
      "A change you kept needs one you dropped. Keep that one too, or drop this one.",
      422
    )
  }

  console.info("template_flow_proposal_rebuilt", {
    actorUserId: request.actorUserId,
    organizationId: request.organizationId,
    templateId: request.templateId,
    operationCount: operations.length,
    durationMs: Math.round(performance.now() - startedAt)
  })

  return createFlowProposal({
    application: validation.application ?? { draft: request.draft, ledgerItems: [], changedBlockIds: [] },
    baseDraftFingerprint,
    createId,
    qualityIssues: validation.qualityIssues,
    wireOperations: operations
  })
}

/**
 * Rebuilds a document Flow proposal from the kept changes, for anyone who may
 * open the document, as {@link rebuildTemplateFlowProposal} does for a template.
 *
 * @param input - Actor, tenant, document, the base draft, its fingerprint, and the kept changes.
 * @param deps - Optional document authorization and id adapters.
 * @returns A fresh pending proposal holding only the kept changes.
 */
export async function rebuildDocumentFlowProposal(
  input: RebuildDocumentFlowProposalInput,
  deps: DocumentFlowServiceDeps = {}
): Promise<TemplateFlowProposal> {
  const { documentId, ...rest } = input

  await authorizeDocumentFlow(input, deps)

  return rebuildTemplateFlowProposal(
    { ...rest, templateId: documentId },
    { ...deps, authorizeTemplateManagement: async (): Promise<void> => {} }
  )
}

async function authorizeDocumentFlow(
  input: { actorUserId: string; documentId: string; organizationId: string },
  deps: DocumentFlowServiceDeps
): Promise<void> {
  const { actorUserId, documentId, organizationId } = input

  // The id comes from the URL; a malformed one is simply not a document.
  if (!z.string().uuid().safeParse(documentId).success) {
    throw new TemplateFlowServiceError("Generated document was not found.", 404)
  }

  try {
    await (
      deps.authorizeDocument ??
      (async (subject): Promise<void> => {
        await getGeneratedDocumentSigningView(subject)
      })
    )({ actorUserId, documentId, organizationId })
  } catch (error: unknown) {
    if (error instanceof DocumentSigningServiceError) {
      throw new TemplateFlowServiceError(error.message, error.statusCode)
    }

    throw error
  }
}

function createFlowProposal(input: {
  application: FlowApplicationResult
  baseDraftFingerprint: string
  createId: () => string
  qualityIssues: TemplateFlowQualityIssue[]
  wireOperations: FlowWireOperation[]
}): TemplateFlowProposal {
  return {
    id: input.createId(),
    status: "pending",
    baseDraftFingerprint: input.baseDraftFingerprint,
    candidateDraft: input.application.draft,
    operations: input.application.ledgerItems,
    wireOperations: input.wireOperations,
    changedBlockIds: input.application.changedBlockIds,
    qualityIssues: input.qualityIssues
  }
}

/**
 * Lists the shared, template-scoped Flow history visible to an actor with
 * template-management permission.
 *
 * @param input - Authenticated actor and tenant-scoped template identifiers.
 * @param deps - Optional authorization, database, and history adapters.
 * @returns Chronological conversation messages, bounded to the latest entries.
 * @throws TemplateFlowServiceError when access cannot be verified.
 */
export async function listTemplateFlowMessages(
  input: ListTemplateFlowMessagesInput,
  deps: Pick<
    TemplateFlowServiceDeps,
    "authorizeTemplateManagement" | "client" | "loadHistory"
  > = {}
): Promise<TemplateFlowMessage[]> {
  const authorizeTemplateManagement =
    deps.authorizeTemplateManagement ??
    ((authorizationInput: {
      actorUserId: string
      organizationId: string
      templateId: string
    }): Promise<void> =>
      requireTemplateManagement(authorizationInput, deps.client))

  await authorizeTemplateManagement({
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    templateId: input.templateId
  })

  return (deps.loadHistory ?? ((history) => loadFlowHistory(history, deps.client)))({
    organizationId: input.organizationId,
    templateId: input.templateId
  })
}

async function authorizeFlowRequest(
  request: FlowSubject,
  deps: TemplateFlowServiceDeps,
  startedAt: number
): Promise<void> {
  try {
    const authorizeTemplateManagement =
      deps.authorizeTemplateManagement ??
      ((authorizationInput: {
        actorUserId: string
        organizationId: string
        templateId: string
      }): Promise<void> =>
        requireTemplateManagement(authorizationInput, deps.client))

    await authorizeTemplateManagement({
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
    return (deps.getAiRuntime ?? createAiRuntime)({ model: request.model })
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
  // The draft, the largest part and the same from one message to the next,
  // leads, so Gemini can reuse what an earlier call read at a discount.
  const request = {
    currentDraft: buildFlowDocumentContext(input.request.draft),
    conversation: input.history
      .slice(-MAX_FLOW_HISTORY_MESSAGES)
      .map((message: TemplateFlowMessage) => ({
        role: message.role,
        content: message.content
      })),
    userMessage: input.request.instruction
  }
  const initialPrompt = JSON.stringify(request)
  const usageReports: AiTokenUsage[] = []
  let currentPrompt = initialPrompt
  let upstreamCalls = 0
  let latestTraceId = input.traceId

  // A valid draft can still have faults Flow can see for itself, such as
  // placeholder choices or a skipped heading level. It gets one rewrite, used
  // only when it has fewer of them. A rewrite that is no better, unreadable or
  // never arrives costs the user nothing: the first draft stands.
  const revise = async (first: FlowProviderResult, firstText: string): Promise<FlowProviderResult> => {
    let calls = first.upstreamCalls
    let outcome = "kept"

    try {
      const faults = readRevisableFaults(input.request.draft, first)

      if (
        first.application === null ||
        faults.length === 0 ||
        performance.now() - input.startedAt > FLOW_REVISE_DEADLINE_MS
      ) {
        return first
      }

      calls += 1
      const result = await input.runtime.provider.generateStructured({
        model,
        input: createFlowRevisePrompt({ request, priorResponse: firstText, faults, draft: first.application.draft }),
        systemInstruction,
        responseSchema,
        maxOutputTokens: FLOW_MAX_OUTPUT_TOKENS,
        traceId: input.traceId
      })

      assertFlowProviderResultModel(result, model, input)
      usageReports.push(result.usage)

      const parsed = parseFlowProviderText(result.text, input.createId)
      const validation = parsed.success
        ? validateFlowCandidate({ createId: input.createId, request: input.request, response: parsed.data })
        : parsed

      if (parsed.success && validation.success && validation.application !== null) {
        const revised = {
          ...first,
          response: parsed.data,
          application: validation.application,
          qualityIssues: validation.qualityIssues,
          traceId: result.traceId
        }

        if (weighFaults(readRevisableFaults(input.request.draft, revised)) < weighFaults(faults)) {
          outcome = "replaced"
          return { ...revised, upstreamCalls: calls, usage: aggregateTokenUsage(usageReports) }
        }
      }
    } catch (error: unknown) {
      outcome = error instanceof AiProviderError ? error.code : "failed"
    } finally {
      if (calls > first.upstreamCalls) {
        console.info("template_flow_revision", {
          organizationId: input.request.organizationId,
          templateId: input.request.templateId,
          provider: model.provider,
          model: model.model,
          outcome,
          durationMs: Math.round(performance.now() - input.startedAt)
        })
      }
    }

    return { ...first, upstreamCalls: calls, usage: aggregateTokenUsage(usageReports) }
  }

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
      // A transient outage uses the same remaining call as a semantic repair;
      // it must never expand the two-call budget or switch models.
      upstreamCalls += 1
      if (
        error instanceof AiProviderError &&
        error.code === AI_PROVIDER_ERROR_CODES.UPSTREAM_UNAVAILABLE &&
        error.retryable &&
        providerCall < FLOW_MAX_UPSTREAM_CALLS &&
        upstreamCalls < FLOW_MAX_UPSTREAM_CALLS
      ) {
        console.warn("template_flow_provider_retrying", JSON.stringify({
          templateId: input.request.templateId,
          organizationId: input.request.organizationId,
          provider: model.provider,
          model: model.model,
          providerStatusCode: error.statusCode,
          traceId: error.traceId,
          upstreamCalls,
          durationMs: Math.round(performance.now() - input.startedAt),
        }))
        await delay(1_000)
        continue
      }
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

    const parsedOutput = parseFlowProviderText(result.text, input.createId)
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
        return revise(
          {
            model,
            response: parsedOutput.data,
            application: candidateValidation.application,
            confirmationQuestion: candidateValidation.confirmationQuestion,
            qualityIssues: candidateValidation.qualityIssues,
            traceId: latestTraceId,
            upstreamCalls,
            usage: aggregateTokenUsage(usageReports)
          },
          result.text
        )
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
        request,
        invalidResponse: result.text,
        issueCode: validationFailure.issueCode,
        issuePath: validationFailure.issuePath,
        detail: validationFailure.detail
      })
    }
  }

  throw new TemplateFlowServiceError(
    "Flow returned changes that failed validation.",
    502
  )
}
