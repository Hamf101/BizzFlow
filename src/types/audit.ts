export const AUDIT_LOG_ACTIONS = [
  "organization.created",
  "invite.created",
  "invite.accepted",
  "membership.role_updated",
  "folder.created",
  "folder.archived",
  "folder.restored",
  "folder.trashed",
  "folder.purged",
  "document.created",
  "document.archived",
  "document.restored",
  "document.trashed",
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
] as const

export type AuditLogAction = (typeof AUDIT_LOG_ACTIONS)[number]

export const AUDIT_LOG_TARGET_TYPES = [
  "organization",
  "invite",
  "membership",
  "folder",
  "document",
  "document_version",
  "submission",
] as const

export type AuditLogTargetType = (typeof AUDIT_LOG_TARGET_TYPES)[number]

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
