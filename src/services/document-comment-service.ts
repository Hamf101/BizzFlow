import { randomUUID } from "node:crypto"

import {
  canPerformOrganizationAction,
  isOrganizationRole,
  type OrganizationPermissionAction,
} from "@/lib/permissions"
import {
  createAdminClient,
  type AdminSupabaseClient,
} from "@/lib/supabase/admin"
import {
  indexDocumentCollaborationProfiles,
  listDocumentCollaborationProfiles,
  resolveDocumentCollaborationDisplayName,
  uniqueDocumentCollaborationProfileIds,
  type DocumentCollaborationProfileRow,
} from "@/services/document-collaboration/profiles"
import type {
  DocumentComment,
  DocumentCommentRow,
} from "@/types/comment"

type DocumentCommentServiceClient = Pick<AdminSupabaseClient, "from" | "rpc">

type LogValue = string | number | boolean | null | undefined

type MembershipRow = {
  role: string
}

type DocumentStateRow = {
  id: string
  archived_at: string | null
}

export type CreateDocumentCommentInput = {
  actorUserId: string
  organizationId: string
  documentId: string
  body: string
}

export type ListDocumentCommentsInput = {
  actorUserId: string
  organizationId: string
  documentId: string
  limit?: number
}

export type DocumentCommentServiceDeps = {
  client?: DocumentCommentServiceClient
  createId?: () => string
}

/**
 * Error raised by document comment operations.
 */
export class DocumentCommentServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates a document comment service error.
   *
   * @param message - User-safe error message.
   * @param statusCode - HTTP-style status code for route/action translation.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "DocumentCommentServiceError"
    this.statusCode = statusCode
  }
}

/**
 * Creates an immutable comment and activity event atomically for an active document.
 *
 * @param input - Actor, tenant, document, and comment body values.
 * @param deps - Optional service dependencies for tests and composition.
 * @returns Created comment with a safe author display label.
 * @throws DocumentCommentServiceError when validation, access, or storage fails.
 */
export async function createDocumentComment(
  input: CreateDocumentCommentInput,
  deps: DocumentCommentServiceDeps = {}
): Promise<DocumentComment> {
  return runDocumentCommentOperation(
    "create_document_comment",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      documentId: input.documentId,
    },
    async (): Promise<DocumentComment> => {
      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "document_comments:create",
        "You cannot comment on documents."
      )

      const body = normalizeCommentBody(input.body)
      const commentId = createId(deps)
      const { data: createdCommentId, error: creationError } = await client.rpc(
        "create_document_comment",
        {
          target_org_id: input.organizationId,
          target_document_id: input.documentId,
          target_comment_id: commentId,
          target_body: body,
          target_actor_user_id: input.actorUserId,
        }
      )

      if (creationError || createdCommentId !== commentId) {
        throw createCommentMutationError(creationError)
      }

      const { data, error } = await client
        .from("document_comments")
        .select("id,org_id,document_id,body,created_by,created_at")
        .eq("id", commentId)
        .eq("org_id", input.organizationId)
        .eq("document_id", input.documentId)
        .single()

      if (error || !data) {
        throw new DocumentCommentServiceError(
          "Unable to create document comment.",
          500
        )
      }

      const profiles = await listDocumentCollaborationProfiles(
        client,
        [input.actorUserId],
        createCommentAuthorsLoadError
      )
      const profileById = indexDocumentCollaborationProfiles(profiles)

      return mapDocumentComment(data as DocumentCommentRow, profileById)
    }
  )
}

/**
 * Lists comments for a tenant-scoped document in newest-first order.
 *
 * @param input - Actor, tenant, document, and optional result limit.
 * @param deps - Optional service dependencies for tests and composition.
 * @returns Comment DTOs with display labels resolved in one profile query.
 * @throws DocumentCommentServiceError when access is denied or data cannot be loaded.
 */
export async function listDocumentComments(
  input: ListDocumentCommentsInput,
  deps: DocumentCommentServiceDeps = {}
): Promise<DocumentComment[]> {
  return runDocumentCommentOperation(
    "list_document_comments",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      documentId: input.documentId,
    },
    async (): Promise<DocumentComment[]> => {
      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "documents:view",
        "You cannot view document comments."
      )
      await requireTenantDocument(
        client,
        input.organizationId,
        input.documentId
      )

      const { data, error } = await client
        .from("document_comments")
        .select("id,org_id,document_id,body,created_by,created_at")
        .eq("org_id", input.organizationId)
        .eq("document_id", input.documentId)
        .order("created_at", { ascending: false })
        .limit(normalizeLimit(input.limit))

      if (error || !data) {
        throw new DocumentCommentServiceError(
          "Unable to load document comments.",
          500
        )
      }

      const rows = data as DocumentCommentRow[]
      const profiles = await listDocumentCollaborationProfiles(
        client,
        uniqueDocumentCollaborationProfileIds(
          rows.map((row: DocumentCommentRow) => row.created_by)
        ),
        createCommentAuthorsLoadError
      )
      const profileById = indexDocumentCollaborationProfiles(profiles)

      return rows.map((row: DocumentCommentRow) =>
        mapDocumentComment(row, profileById)
      )
    }
  )
}

async function requirePermission(
  client: DocumentCommentServiceClient,
  organizationId: string,
  actorUserId: string,
  action: OrganizationPermissionAction,
  rejectionMessage: string
): Promise<void> {
  const { data, error } = await client
    .from("organization_memberships")
    .select("role")
    .eq("org_id", organizationId)
    .eq("user_id", actorUserId)
    .eq("status", "active")
    .maybeSingle()

  if (error) {
    throw new DocumentCommentServiceError(
      "Unable to load document permissions.",
      500
    )
  }

  if (!data) {
    throw new DocumentCommentServiceError(rejectionMessage, 403)
  }

  const role = (data as MembershipRow).role

  if (!isOrganizationRole(role)) {
    throw new DocumentCommentServiceError(
      "Database returned an unsupported organization role.",
      500
    )
  }

  if (!canPerformOrganizationAction(role, action)) {
    throw new DocumentCommentServiceError(rejectionMessage, 403)
  }
}

async function requireTenantDocument(
  client: DocumentCommentServiceClient,
  organizationId: string,
  documentId: string
): Promise<DocumentStateRow> {
  const { data, error } = await client
    .from("documents")
    .select("id,archived_at")
    .eq("id", documentId)
    .eq("org_id", organizationId)
    .maybeSingle()

  if (error) {
    throw new DocumentCommentServiceError("Unable to load document.", 500)
  }

  if (!data) {
    throw new DocumentCommentServiceError("Document was not found.", 404)
  }

  return data as DocumentStateRow
}

function mapDocumentComment(
  row: DocumentCommentRow,
  profileById: ReadonlyMap<string, DocumentCollaborationProfileRow>
): DocumentComment {
  return {
    id: row.id,
    organizationId: row.org_id,
    documentId: row.document_id,
    body: row.body,
    createdBy: row.created_by,
    authorDisplayName: resolveDocumentCollaborationDisplayName(
      row.created_by,
      profileById,
      "Former member"
    ),
    createdAt: row.created_at,
  }
}

function normalizeCommentBody(value: string): string {
  const body = value.trim()

  if (body.length === 0) {
    throw new DocumentCommentServiceError(
      "Comment body cannot be empty.",
      400
    )
  }

  if (body.length > 2000) {
    throw new DocumentCommentServiceError(
      "Comment body cannot exceed 2,000 characters.",
      400
    )
  }

  return body
}

function createCommentAuthorsLoadError(): DocumentCommentServiceError {
  return new DocumentCommentServiceError(
    "Unable to load comment authors.",
    500
  )
}

function createCommentMutationError(error: unknown): DocumentCommentServiceError {
  const errorLike = getSupabaseErrorLike(error)
  const message = [errorLike?.message, errorLike?.details, errorLike?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  if (errorLike?.code === "P0002") {
    return new DocumentCommentServiceError("Document was not found.", 404)
  }

  if (errorLike?.code === "P0001" && message.includes("archived")) {
    return new DocumentCommentServiceError(
      "Archived documents cannot be commented on.",
      409
    )
  }

  return new DocumentCommentServiceError(
    "Unable to create document comment.",
    500
  )
}

function getSupabaseErrorLike(error: unknown): {
  code?: string
  message?: string
  details?: string
  hint?: string
} | null {
  if (!error || typeof error !== "object") {
    return null
  }

  const value = error as Record<string, unknown>

  return {
    code: typeof value.code === "string" ? value.code : undefined,
    message: typeof value.message === "string" ? value.message : undefined,
    details: typeof value.details === "string" ? value.details : undefined,
    hint: typeof value.hint === "string" ? value.hint : undefined,
  }
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return 100
  }

  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new DocumentCommentServiceError(
      "Document comment limit must be between 1 and 100.",
      400
    )
  }

  return value
}

async function runDocumentCommentOperation<T>(
  operationName: string,
  identifiers: Record<string, LogValue>,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now()

  try {
    const result = await operation()
    console.info("document_comment_service_success", {
      operationName,
      durationMs: Date.now() - startedAt,
      ...identifiers,
    })
    return result
  } catch (error: unknown) {
    if (error instanceof DocumentCommentServiceError) {
      console.warn("document_comment_service_rejected", {
        operationName,
        statusCode: error.statusCode,
        reason: error.message,
        durationMs: Date.now() - startedAt,
        ...identifiers,
      })
      throw error
    }

    console.error("document_comment_service_failed", {
      operationName,
      reason: error instanceof Error ? error.message : "Unknown comment error",
      durationMs: Date.now() - startedAt,
      ...identifiers,
    })
    throw new DocumentCommentServiceError(
      "Document comment service failed.",
      500
    )
  }
}

function getClient(deps: DocumentCommentServiceDeps): DocumentCommentServiceClient {
  return deps.client ?? createAdminClient()
}

function createId(deps: DocumentCommentServiceDeps): string {
  return deps.createId ? deps.createId() : randomUUID()
}
