import { randomUUID } from "node:crypto"

import { captureUnexpectedError } from "@/lib/observability"
import {
  canPerformOrganizationAction,
  isOrganizationRole,
  type OrganizationPermissionAction,
  type OrganizationRole,
} from "@/lib/permissions"
import { createAdminClient } from "@/lib/supabase/admin"
import { DocumentStorageServiceError } from "@/services/document-storage-service"
import type {
  DocumentServiceClient,
  DocumentServiceDeps,
  LogValue,
} from "@/services/documents/contracts"
import { DocumentServiceError } from "@/services/documents/errors"
import type {
  DocumentFolder,
  DocumentRow,
  DocumentSummary,
  DocumentVersion,
  DocumentVersionRow,
  DocumentVersionStatus,
  FolderRow,
} from "@/types/document"
import type { OrganizationMembership } from "@/types/organization"

type SupabaseErrorLike = {
  code?: string
  details?: string
  hint?: string
  message?: string
}

type MembershipRow = {
  id: string
  org_id: string
  user_id: string
  role: string
  status: string
  created_at: string
  updated_at: string
}

/**
 * Runs a document operation with consistent logging and error translation.
 *
 * @param operationName - Stable operation identifier for logs.
 * @param identifiers - Context included with operation logs.
 * @param operation - Async document operation to execute.
 * @returns The operation result.
 * @throws DocumentServiceError when the operation is rejected or fails.
 */
export async function runDocumentOperation<T>(
  operationName: string,
  identifiers: Record<string, LogValue>,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now()

  try {
    const result = await operation()
    console.info("document_service_success", {
      operationName,
      durationMs: Date.now() - startedAt,
      ...identifiers,
    })
    return result
  } catch (error: unknown) {
    if (error instanceof DocumentStorageServiceError) {
      const storageError = new DocumentServiceError(
        error.message,
        error.statusCode
      )

      console.warn("document_service_rejected", {
        operationName,
        durationMs: Date.now() - startedAt,
        statusCode: storageError.statusCode,
        reason: storageError.message,
        ...identifiers,
      })
      throw storageError
    }

    if (error instanceof DocumentServiceError) {
      console.warn("document_service_rejected", {
        operationName,
        durationMs: Date.now() - startedAt,
        statusCode: error.statusCode,
        reason: error.message,
        ...identifiers,
      })
      throw error
    }

    const setupError = createDocumentSetupError(error)

    if (setupError) {
      console.warn("document_service_rejected", {
        operationName,
        durationMs: Date.now() - startedAt,
        statusCode: setupError.statusCode,
        reason: setupError.message,
        ...identifiers,
      })
      throw setupError
    }

    console.error("document_service_failed", {
      operationName,
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : "Unknown service error",
      ...identifiers,
    })
    captureUnexpectedError(error, { operationName, ...identifiers })
    throw new DocumentServiceError("Document service failed.", 500)
  }
}

/**
 * Requires an active organization membership with the requested permission.
 *
 * @param client - Supabase client used for membership lookup.
 * @param organizationId - Tenant identifier.
 * @param actorUserId - User requesting the operation.
 * @param action - Permission action to evaluate.
 * @param rejectionMessage - User-safe permission failure message.
 * @returns The actor's active membership.
 * @throws DocumentServiceError when membership loading fails or access is denied.
 */
export async function requirePermission(
  client: DocumentServiceClient,
  organizationId: string,
  actorUserId: string,
  action: OrganizationPermissionAction,
  rejectionMessage: string
): Promise<OrganizationMembership> {
  const membership = await getActiveMembership(
    client,
    organizationId,
    actorUserId
  )

  if (!membership || !canPerformOrganizationAction(membership.role, action)) {
    throw new DocumentServiceError(rejectionMessage, 403)
  }

  return membership
}

/**
 * Loads an active folder scoped to an organization.
 *
 * @param client - Supabase client used for the query.
 * @param organizationId - Tenant identifier.
 * @param folderId - Folder identifier.
 * @returns The active folder DTO.
 * @throws DocumentServiceError when the query fails or the folder is absent.
 */
export async function requireActiveFolder(
  client: DocumentServiceClient,
  organizationId: string,
  folderId: string
): Promise<DocumentFolder> {
  const { data, error } = await client
    .from("folders")
    .select("id,org_id,parent_folder_id,name,created_by,updated_by,archived_by,archived_at,created_at,updated_at")
    .eq("id", folderId)
    .eq("org_id", organizationId)
    .is("archived_at", null)
    .maybeSingle()

  if (error) {
    throw createSupabaseServiceError(error, "Unable to load folder.")
  }

  if (!data) {
    throw new DocumentServiceError("Folder was not found.", 404)
  }

  return mapFolder(data as FolderRow)
}

/**
 * Loads a document scoped to an organization.
 *
 * @param client - Supabase client used for the query.
 * @param organizationId - Tenant identifier.
 * @param documentId - Document identifier.
 * @returns The document summary.
 * @throws DocumentServiceError when the query fails or the document is absent.
 */
export async function getDocumentById(
  client: DocumentServiceClient,
  organizationId: string,
  documentId: string
): Promise<DocumentSummary> {
  const { data, error } = await client
    .from("documents")
    .select("id,org_id,folder_id,title,description,current_version_id,source_kind,template_id,template_revision,created_by,updated_by,archived_by,archived_at,created_at,updated_at")
    .eq("id", documentId)
    .eq("org_id", organizationId)
    .maybeSingle()

  if (error) {
    throw createSupabaseServiceError(error, "Unable to load document.")
  }

  if (!data) {
    throw new DocumentServiceError("Document was not found.", 404)
  }

  return mapDocument(data as DocumentRow)
}

/**
 * Resolves the injected Supabase client or creates the production client.
 *
 * @param deps - Injected document service dependencies.
 * @returns A document service database client.
 */
export function getClient(deps: DocumentServiceDeps): DocumentServiceClient {
  return deps.client ?? createAdminClient()
}

/**
 * Creates an identifier through the injected generator or random UUID fallback.
 *
 * @param deps - Injected document service dependencies.
 * @returns A new identifier.
 */
export function createId(deps: DocumentServiceDeps): string {
  return deps.createId ? deps.createId() : randomUUID()
}

/**
 * Maps a folder database row to the public DTO.
 *
 * @param row - Folder database row.
 * @returns Folder DTO.
 */
export function mapFolder(row: FolderRow): DocumentFolder {
  return {
    id: row.id,
    organizationId: row.org_id,
    parentFolderId: row.parent_folder_id,
    name: row.name,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    archivedBy: row.archived_by,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Maps a document database row to the public DTO.
 *
 * @param row - Document database row.
 * @returns Document summary DTO.
 */
export function mapDocument(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    organizationId: row.org_id,
    folderId: row.folder_id,
    title: row.title,
    description: row.description,
    currentVersionId: row.current_version_id,
    ...(row.source_kind
      ? {
          sourceKind:
            row.source_kind === "generated"
              ? ("generated" as const)
              : ("upload" as const),
          templateId: row.template_id ?? null,
          templateRevision: row.template_revision ?? null,
        }
      : {}),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    archivedBy: row.archived_by,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Maps a document-version database row to the public DTO.
 *
 * @param row - Document version database row.
 * @returns Document version DTO.
 */
export function mapDocumentVersion(
  row: DocumentVersionRow
): DocumentVersion {
  return {
    id: row.id,
    organizationId: row.org_id,
    documentId: row.document_id,
    versionNumber: row.version_number,
    status: parseDocumentVersionStatus(row.status),
    storageKey: row.storage_key,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    byteSize: row.byte_size,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Translates a Supabase failure into a document service error.
 *
 * @param error - Supabase or setup error.
 * @param fallbackMessage - Message used for ordinary database failures.
 * @param fallbackStatusCode - Status used for ordinary database failures.
 * @returns A user-safe document service error.
 */
export function createSupabaseServiceError(
  error: unknown,
  fallbackMessage: string,
  fallbackStatusCode = 500
): DocumentServiceError {
  const setupMessage = getSupabaseSetupFailureMessage(error)

  if (setupMessage) {
    return new DocumentServiceError(setupMessage, 500)
  }

  return new DocumentServiceError(fallbackMessage, fallbackStatusCode)
}

/**
 * Trims an optional identifier and converts empty values to null.
 *
 * @param value - Optional identifier value.
 * @returns A normalized identifier or null.
 */
export function normalizeNullableId(
  value: string | null | undefined
): string | null {
  const normalizedValue = value?.trim()

  return normalizedValue ? normalizedValue : null
}

async function getActiveMembership(
  client: DocumentServiceClient,
  organizationId: string,
  userId: string
): Promise<OrganizationMembership | null> {
  const { data, error } = await client
    .from("organization_memberships")
    .select("id,org_id,user_id,role,status,created_at,updated_at")
    .eq("org_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle()

  if (error) {
    throw createSupabaseServiceError(
      error,
      "Unable to load organization membership."
    )
  }

  return data ? mapMembership(data as MembershipRow) : null
}

function mapMembership(row: MembershipRow): OrganizationMembership {
  return {
    id: row.id,
    organizationId: row.org_id,
    userId: row.user_id,
    role: parseOrganizationRole(row.role),
    status: parseMembershipStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseOrganizationRole(value: string): OrganizationRole {
  if (!isOrganizationRole(value)) {
    throw new DocumentServiceError("Database returned an unsupported role.", 500)
  }

  return value
}

function parseMembershipStatus(value: string): "active" | "disabled" {
  if (value === "active" || value === "disabled") {
    return value
  }

  throw new DocumentServiceError(
    "Database returned an unsupported membership status.",
    500
  )
}

function parseDocumentVersionStatus(value: string): DocumentVersionStatus {
  if (value === "upload_pending" || value === "available") {
    return value
  }

  throw new DocumentServiceError(
    "Database returned an unsupported document version status.",
    500
  )
}

function createDocumentSetupError(error: unknown): DocumentServiceError | null {
  if (!(error instanceof Error)) {
    return null
  }

  if (error.message.includes("Invalid admin Supabase environment")) {
    return new DocumentServiceError(
      "Supabase server credentials are not configured.",
      500
    )
  }

  if (error.message.includes("Invalid R2 environment")) {
    return new DocumentServiceError("Cloudflare R2 is not configured.", 500)
  }

  if (error.message.includes("Invalid file upload policy environment")) {
    return new DocumentServiceError("File upload policy is not configured.", 500)
  }

  return null
}

function getSupabaseSetupFailureMessage(error: unknown): string | null {
  const errorLike = getSupabaseErrorLike(error)
  const searchableMessage = [
    errorLike?.code,
    errorLike?.message,
    errorLike?.details,
    errorLike?.hint,
    error instanceof Error ? error.message : null,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  if (!searchableMessage) {
    return null
  }

  if (
    searchableMessage.includes("invalid api key") ||
    searchableMessage.includes("provided api key")
  ) {
    return "Supabase server credentials are invalid. Re-copy SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY from the Supabase dashboard."
  }

  if (
    errorLike?.code === "42P01" ||
    searchableMessage.includes("does not exist") ||
    searchableMessage.includes("could not find the table") ||
    searchableMessage.includes("schema cache")
  ) {
    return "Supabase database schema is not installed or exposed. Apply the Sprint 2 through Sprint 5 migrations."
  }

  if (
    searchableMessage.includes("permission denied for table") ||
    searchableMessage.includes("permission denied for schema")
  ) {
    return "Supabase table permissions are incomplete. Apply the latest migrations."
  }

  return null
}

function getSupabaseErrorLike(error: unknown): SupabaseErrorLike | null {
  if (!error || typeof error !== "object") {
    return null
  }

  return error as SupabaseErrorLike
}
