import {
  canPerformOrganizationAction,
  isOrganizationRole,
} from "@/lib/permissions"
import type { AdminSupabaseClient } from "@/lib/supabase/admin"

import type {
  FinalizeGeneratedDocumentPdfInput,
  GeneratedDocumentFinalizationPersistence,
  GeneratedDocumentFinalizationRecord,
  PrepareGeneratedDocumentFinalizationInput,
  PromoteGeneratedDocumentFinalizationInput,
} from "./contracts"
import {
  isSha256,
  isUuid,
  normalizeFinalizationMetadataTimestamp,
} from "./domain"
import { GeneratedDocumentFinalizationServiceError } from "./errors"

const FINALIZATION_COLUMNS =
  "id,status,storage_key,render_input_sha256,pdf_sha256,byte_size,document_version_id,created_at"

type SupabaseErrorLike = {
  code?: string
}

type QueryResult = {
  data: unknown
  error: SupabaseErrorLike | null
}

type FinalizationQuery = {
  select: (columns: string) => FinalizationQuery
  eq: (column: string, value: string) => FinalizationQuery
  maybeSingle: () => Promise<QueryResult>
}

type FinalizationDatabaseClient = {
  from: (relation: string) => FinalizationQuery
  rpc: (
    functionName: string,
    args: Record<string, string | number>
  ) => Promise<QueryResult>
}

type MembershipRow = {
  role: unknown
}

type FinalizationRow = {
  id: unknown
  status: unknown
  storage_key: unknown
  render_input_sha256: unknown
  pdf_sha256: unknown
  byte_size: unknown
  document_version_id: unknown
  created_at: unknown
}

/**
 * Creates the Supabase adapter for finalization permission, lookup, and RPCs.
 *
 * The structural cast is intentionally isolated here until generated database
 * types include the new table and functions. Application code depends only on
 * the narrow persistence port.
 *
 * @param adminClient - Server-only Supabase admin client.
 * @returns Persistence port scoped to the finalization use case.
 */
export function createSupabaseFinalizationPersistence(
  adminClient: AdminSupabaseClient
): GeneratedDocumentFinalizationPersistence {
  const client = adminClient as unknown as FinalizationDatabaseClient

  return {
    requireViewPermission: (
      input: FinalizeGeneratedDocumentPdfInput
    ): Promise<void> => requireViewPermission(client, input),
    findByDocument: (
      organizationId: string,
      documentId: string
    ): Promise<GeneratedDocumentFinalizationRecord | null> =>
      findFinalizationByDocument(client, organizationId, documentId),
    prepare: (
      input: PrepareGeneratedDocumentFinalizationInput
    ): Promise<GeneratedDocumentFinalizationRecord> =>
      prepareFinalization(client, input),
    promote: (
      input: PromoteGeneratedDocumentFinalizationInput
    ): Promise<string> => promoteFinalization(client, input),
  }
}

async function requireViewPermission(
  client: FinalizationDatabaseClient,
  input: FinalizeGeneratedDocumentPdfInput
): Promise<void> {
  const { data, error } = await client
    .from("organization_memberships")
    .select("role")
    .eq("org_id", input.organizationId)
    .eq("user_id", input.actorUserId)
    .eq("status", "active")
    .maybeSingle()

  if (error) {
    throw createPersistenceError(
      error,
      "Unable to verify generated document permissions."
    )
  }

  const role = (data as MembershipRow | null)?.role

  if (typeof role !== "string" || !isOrganizationRole(role)) {
    if (data === null) {
      throw new GeneratedDocumentFinalizationServiceError(
        "You cannot view this document.",
        403
      )
    }

    throw new GeneratedDocumentFinalizationServiceError(
      "Database returned an unsupported organization role.",
      500
    )
  }

  if (!canPerformOrganizationAction(role, "documents:view")) {
    throw new GeneratedDocumentFinalizationServiceError(
      "You cannot view this document.",
      403
    )
  }
}

async function findFinalizationByDocument(
  client: FinalizationDatabaseClient,
  organizationId: string,
  documentId: string
): Promise<GeneratedDocumentFinalizationRecord | null> {
  const { data, error } = await client
    .from("generated_document_finalizations")
    .select(FINALIZATION_COLUMNS)
    .eq("org_id", organizationId)
    .eq("document_id", documentId)
    .maybeSingle()

  if (error) {
    throw createPersistenceError(
      error,
      "Unable to load generated document finalization."
    )
  }

  return data === null ? null : mapFinalizationRecord(data)
}

async function prepareFinalization(
  client: FinalizationDatabaseClient,
  input: PrepareGeneratedDocumentFinalizationInput
): Promise<GeneratedDocumentFinalizationRecord> {
  const { data, error } = await client.rpc(
    "prepare_generated_document_finalization",
    {
      target_org_id: input.organizationId,
      target_document_id: input.documentId,
      target_finalization_id: input.finalizationId,
      target_storage_key: input.storageKey,
      target_render_input_sha256: input.renderInputSha256,
      target_created_by: input.createdBy,
    }
  )

  if (error) {
    throw createPersistenceError(
      error,
      "Unable to prepare generated document finalization."
    )
  }

  return mapFinalizationRecord(unwrapRpcRow(data))
}

async function promoteFinalization(
  client: FinalizationDatabaseClient,
  input: PromoteGeneratedDocumentFinalizationInput
): Promise<string> {
  const { data, error } = await client.rpc(
    "promote_generated_document_finalization",
    {
      target_org_id: input.organizationId,
      target_document_id: input.documentId,
      target_finalization_id: input.finalizationId,
      target_pdf_sha256: input.pdfSha256,
      target_byte_size: input.byteSize,
      target_original_filename: input.originalFilename,
      target_finalized_by: input.finalizedBy,
    }
  )

  if (error) {
    throw createPersistenceError(
      error,
      "Unable to promote generated document finalization."
    )
  }

  if (typeof data !== "string" || !isUuid(data)) {
    throw new GeneratedDocumentFinalizationServiceError(
      "Database returned an invalid finalized document version.",
      500
    )
  }

  return data
}

function unwrapRpcRow(data: unknown): unknown {
  if (Array.isArray(data)) {
    if (data.length !== 1) {
      throw new GeneratedDocumentFinalizationServiceError(
        "Database returned an invalid generated document finalization.",
        500
      )
    }

    return data[0]
  }

  return data
}

function mapFinalizationRecord(value: unknown): GeneratedDocumentFinalizationRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throwInvalidFinalizationRecord()
  }

  const row = value as FinalizationRow
  const createdAt = normalizeCreatedAt(row.created_at)
  const isPending = row.status === "pending"
  const isFinalized = row.status === "finalized"

  if (
    typeof row.id !== "string" ||
    !isUuid(row.id) ||
    (!isPending && !isFinalized) ||
    typeof row.storage_key !== "string" ||
    row.storage_key.length === 0 ||
    typeof row.render_input_sha256 !== "string" ||
    !isSha256(row.render_input_sha256)
  ) {
    throwInvalidFinalizationRecord()
  }

  const pdfSha256 = row.pdf_sha256
  const byteSize = row.byte_size
  const documentVersionId = row.document_version_id

  if (
    (pdfSha256 !== null &&
      (typeof pdfSha256 !== "string" || !isSha256(pdfSha256))) ||
    (byteSize !== null &&
      (!Number.isSafeInteger(byteSize) || (byteSize as number) < 1)) ||
    (documentVersionId !== null &&
      (typeof documentVersionId !== "string" || !isUuid(documentVersionId))) ||
    (isPending &&
      (pdfSha256 !== null || byteSize !== null || documentVersionId !== null)) ||
    (isFinalized &&
      (pdfSha256 === null || byteSize === null || documentVersionId === null))
  ) {
    throwInvalidFinalizationRecord()
  }

  return {
    id: row.id,
    status: row.status as "pending" | "finalized",
    storageKey: row.storage_key,
    renderInputSha256: row.render_input_sha256,
    pdfSha256: pdfSha256 as string | null,
    byteSize: byteSize as number | null,
    documentVersionId: documentVersionId as string | null,
    createdAt,
  }
}

function normalizeCreatedAt(value: unknown): string {
  if (typeof value !== "string") {
    throwInvalidFinalizationRecord()
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    throwInvalidFinalizationRecord()
  }

  return normalizeFinalizationMetadataTimestamp(value)
}

function throwInvalidFinalizationRecord(): never {
  throw new GeneratedDocumentFinalizationServiceError(
    "Database returned an invalid generated document finalization.",
    500
  )
}

function createPersistenceError(
  error: SupabaseErrorLike,
  fallbackMessage: string
): GeneratedDocumentFinalizationServiceError {
  if (error.code === "P0002") {
    return new GeneratedDocumentFinalizationServiceError(
      "Generated document was not found.",
      404
    )
  }

  if (
    error.code === "23505" ||
    error.code === "23514" ||
    error.code === "P0001"
  ) {
    return new GeneratedDocumentFinalizationServiceError(
      "Generated document finalization conflicted with persisted state.",
      409
    )
  }

  if (error.code === "22023") {
    return new GeneratedDocumentFinalizationServiceError(
      "Generated document finalization input is invalid.",
      400
    )
  }

  return new GeneratedDocumentFinalizationServiceError(fallbackMessage, 500)
}
