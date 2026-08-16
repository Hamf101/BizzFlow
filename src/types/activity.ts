/**
 * Supported events shown in a document's collaboration timeline.
 */
export const DOCUMENT_ACTIVITY_EVENT_TYPES = [
  "document.uploaded",
  "document.replaced",
  "document.commented",
  "document.archived",
  "document.restored",
  "document.trashed",
  "document.finalized",
] as const

export type DocumentActivityEventType =
  (typeof DOCUMENT_ACTIVITY_EVENT_TYPES)[number]

export type ActivityMetadataValue = string | number | boolean | null
export type ActivityMetadata = Record<string, ActivityMetadataValue>

/**
 * Database row returned for an immutable document activity event.
 */
export type DocumentActivityEventRow = Record<string, unknown> & {
  id: string
  org_id: string
  document_id: string
  actor_user_id: string | null
  event_type: string
  metadata: Record<string, unknown>
  created_at: string
}

/**
 * Tenant-scoped activity event safe to return to application consumers.
 */
export type DocumentActivityEvent = {
  id: string
  organizationId: string
  documentId: string
  actorUserId: string | null
  actorDisplayName: string
  eventType: DocumentActivityEventType
  metadata: ActivityMetadata
  createdAt: string
}
