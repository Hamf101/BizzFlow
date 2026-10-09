import type { DocumentServiceClient } from "@/services/documents/contracts"
import { DocumentServiceError } from "@/services/documents/errors"
import {
  createSupabaseServiceError,
  mapDocumentVersion,
  DOCUMENT_VERSION_COLUMNS,
} from "@/services/documents/shared"
import type {
  DocumentVersion,
  DocumentVersionRow,
} from "@/types/document"
import { asSupabaseError, searchableErrorText } from "@/services/supabase-error"
import { normalizeName } from "@/services/input"


/**
 * Verifies that storage signing returned the deterministic expected object key.
 *
 * @param expectedStorageKey - Key produced by the document storage policy.
 * @param signedStorageKey - Key returned alongside the signed URL.
 * @throws DocumentServiceError when the keys do not match.
 */
export function requireMatchingStorageKey(
  expectedStorageKey: string,
  signedStorageKey: string
): void {
  if (signedStorageKey !== expectedStorageKey) {
    throw new DocumentServiceError(
      "Document storage key could not be verified.",
      500
    )
  }
}

/**
 * Loads one document version scoped to its organization and document.
 *
 * @param client - Document service database client.
 * @param organizationId - Tenant identifier.
 * @param documentId - Parent document identifier.
 * @param versionId - Version identifier.
 * @returns Mapped document version.
 * @throws DocumentServiceError when the query fails or the version is absent.
 */
export async function getDocumentVersionById(
  client: DocumentServiceClient,
  organizationId: string,
  documentId: string,
  versionId: string
): Promise<DocumentVersion> {
  const { data, error } = await client
    .from("document_versions")
    .select(DOCUMENT_VERSION_COLUMNS)
    .eq("id", versionId)
    .eq("org_id", organizationId)
    .eq("document_id", documentId)
    .maybeSingle()

  if (error) {
    throw createSupabaseServiceError(error, "Unable to load document version.")
  }

  if (!data) {
    throw new DocumentServiceError("Document version was not found.", 404)
  }

  return mapDocumentVersion(data as DocumentVersionRow)
}

/**
 * Translates version-allocation or completion RPC failures.
 *
 * @param error - Supabase RPC failure.
 * @param fallbackMessage - Workflow-specific failure message.
 * @returns Conflict-aware document service error.
 */
export function createVersionMutationError(
  error: unknown,
  fallbackMessage: string
): DocumentServiceError {
  const errorLike = asSupabaseError(error)
  const message = searchableErrorText(errorLike)
  const isConflict =
    errorLike?.code === "23505" ||
    (errorLike?.code === "P0001" &&
      (message.includes("document") || message.includes("version")))

  return createSupabaseServiceError(
    error,
    fallbackMessage,
    isConflict ? 409 : 500
  )
}

/**
 * Normalizes and validates a user-supplied original filename.
 *
 * @param filename - Original client filename.
 * @returns Trimmed filename with collapsed whitespace.
 * @throws DocumentServiceError when the filename is empty or too long.
 */
export function normalizeOriginalFilename(filename: string): string {
  return normalizeName(filename, "Original filename", 1, 255, (message) => new DocumentServiceError(message, 400))
}

