import type { GeneratedDocumentFinalizationRecord } from "./contracts"
import { GeneratedDocumentFinalizationServiceError } from "./errors"

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Builds the immutable private R2 key for a generated final PDF.
 *
 * @param organizationId - Tenant identifier.
 * @param documentId - Generated-document identifier.
 * @param finalizationId - Stable finalization identifier.
 * @returns Exact key enforced by the database finalization contract.
 */
export function buildGeneratedDocumentFinalizationStorageKey(
  organizationId: string,
  documentId: string,
  finalizationId: string
): string {
  return [
    "organizations",
    organizationId,
    "documents",
    documentId,
    "finalizations",
    finalizationId,
    "final.pdf",
  ].join("/")
}

/**
 * Normalizes a document title to a safe final PDF filename.
 *
 * @param title - Persisted generated-document title.
 * @returns ASCII filename no longer than 255 characters.
 */
export function normalizeFinalPdfFilename(title: string): string {
  const suffix = "-final.pdf"
  const safeStem = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 255 - suffix.length)

  return `${safeStem || "document"}${suffix}`
}

/**
 * Canonicalizes database creation metadata to PDF's whole-second precision.
 *
 * @param value - Timestamp returned by the prepare RPC.
 * @returns Stable UTC timestamp with zero milliseconds.
 * @throws GeneratedDocumentFinalizationServiceError when invalid.
 */
export function normalizeFinalizationMetadataTimestamp(value: string): string {
  const timestamp = new Date(value)

  if (Number.isNaN(timestamp.getTime())) {
    throw new GeneratedDocumentFinalizationServiceError(
      "Generated document finalization timestamp is invalid.",
      500
    )
  }

  timestamp.setUTCMilliseconds(0)
  return timestamp.toISOString()
}

/**
 * Requires an identifier to be a database-compatible UUID.
 *
 * @param value - Identifier supplied to the state machine.
 * @param label - User-safe field label for validation errors.
 * @throws GeneratedDocumentFinalizationServiceError when invalid.
 */
export function requireUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new GeneratedDocumentFinalizationServiceError(
      `${label} is invalid.`,
      400
    )
  }
}

/**
 * Verifies that a prepared row represents this exact render request.
 *
 * @param record - Row returned by the prepare RPC.
 * @param organizationId - Expected tenant identifier.
 * @param documentId - Expected generated-document identifier.
 * @param renderInputSha256 - Canonical document-derived input hash.
 * @throws GeneratedDocumentFinalizationServiceError on any mismatch.
 */
export function assertPreparedFinalization(
  record: GeneratedDocumentFinalizationRecord,
  organizationId: string,
  documentId: string,
  renderInputSha256: string
): void {
  const expectedStorageKey = buildGeneratedDocumentFinalizationStorageKey(
    organizationId,
    documentId,
    record.id
  )

  if (
    record.storageKey !== expectedStorageKey ||
    record.renderInputSha256 !== renderInputSha256
  ) {
    throw new GeneratedDocumentFinalizationServiceError(
      "Generated document finalization state does not match this render.",
      409
    )
  }
}

/**
 * Verifies that an existing row uses the key derived from its identifiers.
 *
 * @param record - Tenant-scoped row loaded for the document.
 * @param organizationId - Expected tenant identifier.
 * @param documentId - Expected generated-document identifier.
 * @throws GeneratedDocumentFinalizationServiceError when the key is invalid.
 */
export function assertFinalizationStorageKey(
  record: GeneratedDocumentFinalizationRecord,
  organizationId: string,
  documentId: string
): void {
  const expectedStorageKey = buildGeneratedDocumentFinalizationStorageKey(
    organizationId,
    documentId,
    record.id
  )

  if (record.storageKey !== expectedStorageKey) {
    throw new GeneratedDocumentFinalizationServiceError(
      "Generated document finalization storage state is invalid.",
      500
    )
  }
}

/** Returns whether a value is a canonical SHA-256 hexadecimal digest. */
export function isSha256(value: string): boolean {
  return SHA256_PATTERN.test(value)
}

/** Returns whether a value is a database-compatible UUID. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}
