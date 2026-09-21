export const AUDIT_LOG_ACTIONS = [
  "organization.created",
  "organization.navigation_renamed",
  "invite.created",
  "invite.accepted",
  "invite.revoked",
  "membership.role_updated",
  "organization_role.created",
  "organization_role.updated",
  "organization_role.archived",
  "membership.access_updated",
  "folder.created",
  "folder.archived",
  "folder.restored",
  "folder.trashed",
  "folder.moved",
  "folder.purged",
  "document.created",
  "document.archived",
  "document.restored",
  "document.trashed",
  "document.moved",
  "document.purged",
  "document.access_granted",
  "document.access_revoked",
  "document.finalized",
  "document_version.created",
  "document_version.download_url_issued",
  "submission.created",
  "submission.submitted",
  "submission.resubmitted",
  "submission.assigned",
  "submission.commented",
  "submission.changes_requested",
  "submission.approved",
  "submission.rejected",
  "submission.completed",
  "task.created",
  "task.updated",
  "task.assigned",
  "task.status_changed",
  "task_reminder.scheduled",
  "task_reminder.cancelled",
  "notification.sent",
  "notification.failed",
  "notification.suppressed",
] as const

export type AuditLogAction = (typeof AUDIT_LOG_ACTIONS)[number]

export const AUDIT_LOG_TARGET_TYPES = [
  "organization",
  "invite",
  "membership",
  "organization_role",
  "folder",
  "document",
  "document_version",
  "submission",
  "task",
  "task_reminder",
  "notification",
] as const

export type AuditLogTargetType = (typeof AUDIT_LOG_TARGET_TYPES)[number]

/** Orders the audit list offers; `created` follows the chain's sequence. */
export const AUDIT_LOG_SORT_KEYS = ["created"] as const

/** One audit list ordering key. */
export type AuditLogSortKey = (typeof AUDIT_LOG_SORT_KEYS)[number]

export type AuditMetadataValue = string | number | boolean | null

export type AuditMetadata = Record<string, AuditMetadataValue>

export type AuditLogEntry = {
  id: string
  organizationId: string
  actorUserId: string | null
  action: AuditLogAction
  targetType: AuditLogTargetType
  targetId: string | null
  metadata: AuditMetadata
  seq: number
  prevHash: string | null
  entryHash: string
  createdAt: string
}

export type AuditChainVerification = {
  valid: boolean
  checkedCount: number
  firstInvalidSeq: number | null
  failureReason: string | null
}
