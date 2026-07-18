import type { DocumentServiceClient } from "@/services/documents/contracts"
import { DocumentServiceError } from "@/services/documents/errors"
import {
  createSupabaseServiceError,
  mapDocumentVersion,
} from "@/services/documents/shared"
import type {
  DocumentVersion,
  DocumentVersionRow,
} from "@/types/document"

type SupabaseErrorLike = {
  code?: string
  details?: string
  hint?: string
  message?: string
}

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
    .select("id,org_id,document_id,version_number,status,storage_key,original_filename,content_type,byte_size,checksum_sha256,uploaded_by,created_at,updated_at")
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
  const errorLike = getSupabaseErrorLike(error)
  const message = [errorLike?.message, errorLike?.details, errorLike?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
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
  const normalizedFilename = filename.trim().replace(/\s+/g, " ")

  if (normalizedFilename.length < 1 || normalizedFilename.length > 255) {
    throw new DocumentServiceError(
      "Original filename must be between 1 and 255 characters.",
      400
    )
  }

  return normalizedFilename
}

function getSupabaseErrorLike(error: unknown): SupabaseErrorLike | null {
  if (!error || typeof error !== "object") {
    return null
  }

  return error as SupabaseErrorLike
}
