/**
 * Database row returned for an immutable document comment.
 */
export type DocumentCommentRow = Record<string, unknown> & {
  id: string
  org_id: string
  document_id: string
  body: string
  created_by: string | null
  created_at: string
}

/**
 * Tenant-scoped document comment safe to return to application consumers.
 */
export type DocumentComment = {
  id: string
  organizationId: string
  documentId: string
  body: string
  createdBy: string | null
  authorDisplayName: string
  createdAt: string
}
