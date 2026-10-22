import { createHash, randomUUID } from "node:crypto"

import { createAdminClient, type AdminSupabaseClient } from "@/lib/supabase/admin"
import {
  renderGeneratedDocumentPdf,
  DocumentPdfServiceError,
} from "@/services/document-pdf-service"
import { DocumentSigningServiceError, sendSignedCopies } from "@/services/document-signing-service"
import { loadGeneratedDocumentView } from "@/services/document-signing/persistence"
import { readTemplateImage } from "@/services/template-image-service"
import type {
  CompletedGeneratedDocument,
  FinalizeGeneratedDocumentPdfInput,
  FinalizeGeneratedDocumentPdfResult,
  GeneratedDocumentFinalizationServiceDeps,
  GeneratedDocumentFinalizationStorage,
  GeneratedDocumentSigningViewLoader,
  PreparedFinalRender,
} from "./generated-document-finalization/contracts"
import {
  assertFinalizationStorageKey,
  assertPreparedFinalization,
  buildGeneratedDocumentFinalizationStorageKey,
  isUuid,
  normalizeFinalPdfFilename,
  normalizeFinalizationMetadataTimestamp,
  requireUuid,
} from "./generated-document-finalization/domain"
import { GeneratedDocumentFinalizationServiceError } from "./generated-document-finalization/errors"
import { createSupabaseFinalizationPersistence } from "./generated-document-finalization/persistence"
import { buildCanonicalFinalizationRenderInput } from "./generated-document-finalization/render-input"
import { createR2FinalizationStorage } from "./generated-document-finalization/storage"

export { GeneratedDocumentFinalizationServiceError } from "./generated-document-finalization/errors"
export type {
  FinalizeGeneratedDocumentPdfInput,
  FinalizeGeneratedDocumentPdfResult,
  GeneratedDocumentFinalizationServiceDeps,
  PreparedFinalRender,
} from "./generated-document-finalization/contracts"

/**
 * Finalizes a completed generated document into one immutable private PDF.
 *
 * The database owns allocation and promotion, while R2 operations run strictly
 * between those RPCs. Replays return an already finalized version immediately,
 * and concurrent callers reconcile the same create-only object. The persisted
 * render-input hash covers only immutable document/signing data; the prepare
 * RPC's whole-second `created_at` is added afterward as deterministic PDF
 * metadata and is deliberately excluded from that document-state fingerprint.
 *
 * @param input - Actor, organization, and generated-document identifiers.
 * @param deps - Optional persistence, view, renderer, storage, ID, and clock ports.
 * @returns Stable finalization and document-version identifiers.
 * @throws GeneratedDocumentFinalizationServiceError for access, state, storage,
 * rendering, or persistence failures.
 */
export async function finalizeGeneratedDocumentPdf(
  input: FinalizeGeneratedDocumentPdfInput,
  deps: GeneratedDocumentFinalizationServiceDeps = {}
): Promise<FinalizeGeneratedDocumentPdfResult> {
  return finalizeDocumentPdf(input, deps, (getClient) => {
    const loadSigningView = deps.loadSigningView ?? createDefaultSigningViewLoader(getClient())

    return async (): Promise<PreparedFinalRender> => {
      const view = await loadSigningView(input)

      if (
        view.document.id !== input.documentId ||
        view.document.organizationId !== input.organizationId
      ) {
        throw new GeneratedDocumentFinalizationServiceError(
          "Generated document view does not match this finalization request.",
          500
        )
      }

      const canonicalRender = buildCanonicalFinalizationRenderInput(view)

      return {
        completed: view.workflowStatus === "completed",
        filename: normalizeFinalPdfFilename(view.document.title),
        render: (metadataTimestamp: string) =>
          (deps.renderPdf ?? renderGeneratedDocumentPdf)(
            { ...canonicalRender.input, metadataTimestamp },
            // Stored pictures never change once uploaded, so the final PDF stays reproducible.
            { readImage: (asset) => readTemplateImage(input.organizationId, asset) }
          ),
        sha256: canonicalRender.sha256,
      }
    }
  })
}

/**
 * Finalizes a completed document into one immutable private PDF, made by the
 * given source: allocated, stored once and promoted to the document's newest
 * version, exactly as a generated document is.
 *
 * @param input - Actor, organization, and document identifiers.
 * @param deps - Optional persistence, storage, ID, and clock ports.
 * @param source - Given the database, what the final PDF is made from.
 * @returns Stable finalization and document-version identifiers.
 * @throws GeneratedDocumentFinalizationServiceError for access, state, storage,
 * rendering, or persistence failures.
 */
export async function finalizeDocumentPdf(
  input: FinalizeGeneratedDocumentPdfInput,
  deps: GeneratedDocumentFinalizationServiceDeps,
  source: (getClient: () => AdminSupabaseClient) => () => Promise<PreparedFinalRender>
): Promise<FinalizeGeneratedDocumentPdfResult> {
  const clock = deps.clock ?? performance.now.bind(performance)
  const startedAt = clock()
  let finalizationId: string | undefined

  try {
    validateFinalizationInput(input)

    const getClient = createLazyAdminClient(deps.client)
    const persistence =
      deps.persistence ??
      createSupabaseFinalizationPersistence(getClient())
    const loadRender = source(getClient)
    const storage = deps.storage ?? createDefaultStorage(deps)

    await persistence.requireViewPermission(input)

    const existing = await persistence.findByDocument(
      input.organizationId,
      input.documentId
    )

    if (existing) {
      finalizationId = existing.id
      assertFinalizationStorageKey(
        existing,
        input.organizationId,
        input.documentId
      )

      if (existing.status === "finalized") {
        const result = requireFinalizedResult(
          existing.id,
          existing.documentVersionId
        )

        logFinalizationSuccess(input, result, clock() - startedAt, true)
        return result
      }
    }

    const canonicalRender = await loadRender()

    if (!canonicalRender.completed) {
      throw new GeneratedDocumentFinalizationServiceError(
        "Only completed documents can be finalized.",
        409
      )
    }

    // A pending attempt from different render input (one prepared before
    // signers were ordered by signer number) is never reused: prepare discards
    // it, and its object, if stored, stays under its own key.
    const resumable =
      existing?.renderInputSha256 === canonicalRender.sha256 ? existing : null
    const candidateId = resumable?.id ?? (deps.createId ?? randomUUID)()

    requireUuid(candidateId, "Generated document finalization id")
    finalizationId = candidateId

    const candidateStorageKey =
      resumable?.storageKey ??
      buildGeneratedDocumentFinalizationStorageKey(
        input.organizationId,
        input.documentId,
        candidateId
      )
    const prepared = await persistence.prepare({
      organizationId: input.organizationId,
      documentId: input.documentId,
      finalizationId: candidateId,
      storageKey: candidateStorageKey,
      renderInputSha256: canonicalRender.sha256,
      createdBy: input.actorUserId,
    })

    finalizationId = prepared.id
    assertPreparedFinalization(
      prepared,
      input.organizationId,
      input.documentId,
      canonicalRender.sha256
    )

    if (prepared.status === "finalized") {
      const result = requireFinalizedResult(
        prepared.id,
        prepared.documentVersionId
      )

      logFinalizationSuccess(input, result, clock() - startedAt, true)
      return result
    }

    const pdf = Buffer.from(
      await canonicalRender.render(
        normalizeFinalizationMetadataTimestamp(prepared.createdAt)
      )
    )

    if (pdf.length < 1) {
      throw new GeneratedDocumentFinalizationServiceError(
        "Generated document PDF renderer returned no bytes.",
        500
      )
    }

    const pdfSha256 = createHash("sha256").update(pdf).digest("hex")

    await storage.store({
      organizationId: input.organizationId,
      documentId: input.documentId,
      finalizationId: prepared.id,
      storageKey: prepared.storageKey,
      pdf,
      pdfSha256,
    })

    const versionId = await persistence.promote({
      organizationId: input.organizationId,
      documentId: input.documentId,
      finalizationId: prepared.id,
      pdfSha256,
      byteSize: pdf.length,
      originalFilename: canonicalRender.filename,
      finalizedBy: input.actorUserId,
    })

    if (!isUuid(versionId)) {
      throw new GeneratedDocumentFinalizationServiceError(
        "Database returned an invalid finalized document version.",
        500
      )
    }

    const result = {
      finalizationId: prepared.id,
      versionId,
    }

    logFinalizationSuccess(input, result, clock() - startedAt, false)
    return result
  } catch (error: unknown) {
    const normalizedError = normalizeFinalizationError(error)

    console.warn("generated_document_finalization_failed", {
      organizationId: input.organizationId,
      documentId: input.documentId,
      finalizationId,
      statusCode: normalizedError.statusCode,
      durationMs: Math.round(clock() - startedAt),
    })
    throw normalizedError
  }
}

/**
 * Reads which version holds a document's finalized PDF, without creating one,
 * so reading a document never writes to storage or the database.
 *
 * @param input - Actor, organization, and generated-document identifiers.
 * @param deps - Optional persistence and client ports.
 * @returns The finalized version id, or null while there is none yet.
 * @throws GeneratedDocumentFinalizationServiceError when the actor cannot read it.
 */
export async function findFinalizedGeneratedDocumentVersionId(
  input: FinalizeGeneratedDocumentPdfInput,
  deps: GeneratedDocumentFinalizationServiceDeps = {}
): Promise<string | null> {
  try {
    validateFinalizationInput(input)
    const persistence =
      deps.persistence ??
      createSupabaseFinalizationPersistence(createLazyAdminClient(deps.client)())

    await persistence.requireViewPermission(input)
    const existing = await persistence.findByDocument(input.organizationId, input.documentId)

    return existing?.status === "finalized"
      ? requireFinalizedResult(existing.id, existing.documentVersionId).versionId
      : null
  } catch (error: unknown) {
    throw normalizeFinalizationError(error)
  }
}

/**
 * Finalizes a document whose last signature just landed, on behalf of the
 * member who created it. Best effort: until it succeeds the PDF route serves a
 * no-store preview, and finalizeGeneratedDocumentPdf already logs the failure.
 *
 * @param document - The completed document.
 * @param deps - Optional finalization ports.
 * @returns Whether the document now has its finalized PDF.
 */
export async function finalizeCompletedGeneratedDocument(
  document: CompletedGeneratedDocument,
  deps: GeneratedDocumentFinalizationServiceDeps = {}
): Promise<boolean> {
  // ponytail: a document whose creator is gone stays a preview; pick another reader if that matters.
  if (!document.createdBy) {
    return false
  }

  const finalized = await finalizeGeneratedDocumentPdf(
    { actorUserId: document.createdBy, organizationId: document.organizationId, documentId: document.id },
    deps
  ).then(
    () => true,
    () => false
  )

  if (finalized) {
    // Best effort, and once: a document whose copies went out is left alone.
    await (deps.sendSignedCopies ?? sendSignedCopies)({ organizationId: document.organizationId, documentId: document.id }).catch(() => undefined)
  }

  return finalized
}

/** Completed documents one sweep finalizes, each rendered in turn. */
const FINALIZATION_SWEEP_BATCH = 10

/**
 * Finalizes one bounded batch of completed documents that have no finalized
 * PDF: those completed before finalizing moved to the last signature, and any
 * whose finalizing then failed. Each is finalized as on completion, so a
 * document finalized meanwhile is returned as it is.
 *
 * @param deps - Optional finalization ports.
 * @returns How many documents were found and how many are now finalized.
 */
export async function finalizeCompletedGeneratedDocuments(
  deps: GeneratedDocumentFinalizationServiceDeps = {}
): Promise<{ scannedCount: number; finalizedCount: number }> {
  const persistence =
    deps.persistence ?? createSupabaseFinalizationPersistence(createLazyAdminClient(deps.client)())
  const documents = await persistence.listUnfinalized(FINALIZATION_SWEEP_BATCH)
  let finalizedCount = 0

  // One at a time: each renders a whole PDF.
  for (const document of documents) {
    if (await finalizeCompletedGeneratedDocument(document, { ...deps, persistence })) {
      finalizedCount += 1
    }
  }

  return { scannedCount: documents.length, finalizedCount }
}

function logFinalizationSuccess(
  input: FinalizeGeneratedDocumentPdfInput,
  result: FinalizeGeneratedDocumentPdfResult,
  durationMs: number,
  replayed: boolean
): void {
  console.info("generated_document_finalization_completed", {
    organizationId: input.organizationId,
    documentId: input.documentId,
    finalizationId: result.finalizationId,
    versionId: result.versionId,
    replayed,
    durationMs: Math.round(durationMs),
  })
}

function createLazyAdminClient(
  injectedClient: AdminSupabaseClient | undefined
): () => AdminSupabaseClient {
  let client = injectedClient

  return (): AdminSupabaseClient => {
    client ??= createAdminClient()
    return client
  }
}

function createDefaultSigningViewLoader(
  client: AdminSupabaseClient
): GeneratedDocumentSigningViewLoader {
  // The paper is the same whoever opens it first, so it is rendered from the
  // whole record once the caller's right to read it has been checked.
  return (input: FinalizeGeneratedDocumentPdfInput) =>
    loadGeneratedDocumentView(client, input.organizationId, input.documentId)
}

function createDefaultStorage(
  deps: GeneratedDocumentFinalizationServiceDeps
): GeneratedDocumentFinalizationStorage {
  return createR2FinalizationStorage({
    r2Client: deps.r2Client,
    r2Env: deps.r2Env,
    putObject: deps.putObject,
    headObject: deps.headObject,
  })
}

function validateFinalizationInput(
  input: FinalizeGeneratedDocumentPdfInput
): void {
  requireUuid(input.actorUserId, "Actor user id")
  requireUuid(input.organizationId, "Organization id")
  requireUuid(input.documentId, "Document id")
}

function requireFinalizedResult(
  finalizationId: string,
  versionId: string | null
): FinalizeGeneratedDocumentPdfResult {
  if (!versionId || !isUuid(versionId)) {
    throw new GeneratedDocumentFinalizationServiceError(
      "Finalized document version state is invalid.",
      500
    )
  }

  return { finalizationId, versionId }
}

function normalizeFinalizationError(
  error: unknown
): GeneratedDocumentFinalizationServiceError {
  if (error instanceof GeneratedDocumentFinalizationServiceError) {
    return error
  }

  if (
    error instanceof DocumentSigningServiceError ||
    error instanceof DocumentPdfServiceError
  ) {
    return new GeneratedDocumentFinalizationServiceError(
      error.message,
      error.statusCode
    )
  }

  return new GeneratedDocumentFinalizationServiceError(
    "Unable to finalize generated document PDF.",
    500
  )
}
