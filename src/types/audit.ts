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
  "folder.access_granted",
  "folder.access_revoked",
  "folder.sharing_inheritance_changed",
  "document.created",
  "document.archived",
  "document.restored",
  "document.trashed",
  "document.moved",
  "document.purged",
  "document.access_granted",
  "document.access_revoked",
  "document.guest_joined",
  "document.sent_to_answer",
  "document.sharing_inheritance_changed",
  "document.finalized",
  "document_version.created",
  "document_version.download_url_issued",
  "template.access_granted",
  "template.access_revoked",
  "template.sharing_restriction_changed",
  "template.sent_to_answer",
  "template.trashed",
  "template.restored",
  "template.purged",
  "public_form_link.created",
  "public_form_link.disabled",
  "public_form_link.resent",
  "public_form_link.revoked",
  "submission.created",
  "submission.submitted",
  "submission.resubmitted",
  "submission.assigned",
  "submission.commented",
  "submission.changes_requested",
  "submission.approved",
  "submission.rejected",
  "submission.completed",
  "submission.review_approved",
  "submission.changes_dismissed",
  "submission.reviewer_removed",
  "submission.shared",
  "submission.unshared",
  "submission.answers_suggested",
  "submission.suggestion_accepted",
  "submission.suggestion_declined",
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
  "template",
  "public_form_link",
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
  /** Usually an AuditLogAction; a newer action this build does not know is kept as written. */
  action: string
  /** Usually an AuditLogTargetType; kept as written when this build does not know it. */
  targetType: string
  targetId: string | null
  metadata: AuditMetadata
  seq: number
  createdAt: string
}
