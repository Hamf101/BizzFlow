import { createHash, randomUUID } from "node:crypto"

import { createAdminClient, type AdminSupabaseClient } from "@/lib/supabase/admin"
import {
  renderGeneratedDocumentPdf,
  DocumentPdfServiceError,
} from "@/services/document-pdf-service"
import {
  getGeneratedDocumentSigningView,
  DocumentSigningServiceError,
} from "@/services/document-signing-service"

import type {
  FinalizeGeneratedDocumentPdfInput,
  FinalizeGeneratedDocumentPdfResult,
  GeneratedDocumentFinalizationServiceDeps,
  GeneratedDocumentFinalizationStorage,
  GeneratedDocumentSigningViewLoader,
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
  const clock = deps.clock ?? performance.now.bind(performance)
  const startedAt = clock()
  let finalizationId: string | undefined

  try {
    validateFinalizationInput(input)

    const getClient = createLazyAdminClient(deps.client)
    const persistence =
      deps.persistence ??
      createSupabaseFinalizationPersistence(getClient())
    const loadSigningView =
      deps.loadSigningView ?? createDefaultSigningViewLoader(getClient())
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

    if (view.workflowStatus !== "completed") {
      throw new GeneratedDocumentFinalizationServiceError(
        "Only completed generated documents can be finalized.",
        409
      )
    }

    const canonicalRender = buildCanonicalFinalizationRenderInput(view)
    const candidateId = existing?.id ?? (deps.createId ?? randomUUID)()

    requireUuid(candidateId, "Generated document finalization id")
    finalizationId = candidateId

    const candidateStorageKey =
      existing?.storageKey ??
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

    const pdf = await (deps.renderPdf ?? renderGeneratedDocumentPdf)({
      ...canonicalRender.input,
      metadataTimestamp: normalizeFinalizationMetadataTimestamp(
        prepared.createdAt
      ),
    })

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
      originalFilename: normalizeFinalPdfFilename(view.document.title),
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
  return (input: FinalizeGeneratedDocumentPdfInput) =>
    getGeneratedDocumentSigningView(input, { client })
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
