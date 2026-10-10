import { randomUUID } from "node:crypto"

import type { OrganizationPermissionAction } from "@/lib/permissions"
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
import {
  requireDocumentAccess,
  requireDocumentAccessAs,
  requireReadableDocument,
} from "@/services/documents/access-service"
import type {
  DocumentComment,
  DocumentCommentRow,
} from "@/types/comment"
import { runOperation, type LogValue } from "@/services/operation"
import { ServiceError } from "@/services/service-error"
import { normalizeLimit } from "@/services/input"

// Every column a comment read maps.
const COMMENT_COLUMNS =
  "id,org_id,document_id,body,created_by,created_at"

type DocumentCommentServiceClient = Pick<AdminSupabaseClient, "from" | "rpc">

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
export class DocumentCommentServiceError extends ServiceError {
  override readonly name = "DocumentCommentServiceError"
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

      await requireCommentDocumentAccess(
        client,
        input.organizationId,
        input.documentId,
        input.actorUserId,
        "viewer",
        "mutation",
        "document_comments:create",
        "You cannot comment on documents."
      )
      await requireTenantDocument(
        client,
        input.organizationId,
        input.documentId,
        "mutation"
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
        .select(COMMENT_COLUMNS)
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

      await requireCommentDocumentAccess(
        client,
        input.organizationId,
        input.documentId,
        input.actorUserId,
        "viewer",
        "read",
        "documents:view",
        "You cannot view document comments."
      )
      await requireTenantDocument(
        client,
        input.organizationId,
        input.documentId,
        "read"
      )

      const { data, error } = await client
        .from("document_comments")
        .select(COMMENT_COLUMNS)
        .eq("org_id", input.organizationId)
        .eq("document_id", input.documentId)
        .order("created_at", { ascending: false })
        .limit(normalizeLimit(input.limit, "Document comment", 100, 100, (message) => new DocumentCommentServiceError(message, 400)))

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

async function requireCommentDocumentAccess(
  client: DocumentCommentServiceClient,
  organizationId: string,
  documentId: string,
  actorUserId: string,
  requiredAccess: "viewer" | "contributor",
  operation: "read" | "mutation",
  action: OrganizationPermissionAction,
  rejectionMessage: string
): Promise<void> {
  await requireDocumentAccessAs(
    requireDocumentAccess(
      {
        organizationId,
        documentId,
        actorUserId,
        requiredAccess,
        operation,
        requiredOrganizationPermissionAction: action,
      },
      client
    ),
    (message, statusCode) => new DocumentCommentServiceError(message, statusCode),
    rejectionMessage
  )
}

// Trash, purge and any state newer than this build read as not found.
async function requireTenantDocument(
  client: DocumentCommentServiceClient,
  organizationId: string,
  documentId: string,
  operation: "read" | "mutation"
): Promise<void> {
  requireReadableDocument(
    await client
      .from("documents")
      .select("id,lifecycle_state")
      .eq("id", documentId)
      .eq("org_id", organizationId)
      .maybeSingle(),
    {
      loadFailed: () => new DocumentCommentServiceError("Unable to load document.", 500),
      notFound: () => new DocumentCommentServiceError("Document was not found.", 404),
      ...(operation === "mutation"
        ? { archived: () => new DocumentCommentServiceError("Archived documents cannot be commented on.", 409) }
        : {}),
    }
  )
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

  if (
    (errorLike?.code === "P0001" || errorLike?.code === "23514") &&
    (message.includes("archived") ||
      message.includes("not active") ||
      message.includes("only active documents") ||
      message.includes("lifecycle"))
  ) {
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


function runDocumentCommentOperation<T>(
  operationName: string,
  identifiers: Record<string, LogValue>,
  operation: () => Promise<T>
): Promise<T> {
  return runOperation("document_comment", toDocumentCommentServiceError, operationName, identifiers, operation)
}

function toDocumentCommentServiceError(error: unknown): DocumentCommentServiceError {
  return error instanceof DocumentCommentServiceError
    ? error
    : new DocumentCommentServiceError("Document comment service failed.", 500)
}

function getClient(deps: DocumentCommentServiceDeps): DocumentCommentServiceClient {
  return deps.client ?? createAdminClient()
}

function createId(deps: DocumentCommentServiceDeps): string {
  return deps.createId ? deps.createId() : randomUUID()
}
