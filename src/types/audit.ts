export type AuditLogAction =
  | "organization.created"
  | "invite.created"
  | "invite.accepted"
  | "membership.role_updated"
  | "folder.created"
  | "folder.archived"
  | "document.created"
  | "document.archived"
  | "document.finalized"
  | "document_version.created"
  | "document_version.download_url_issued"
  | "submission.created"
  | "submission.submitted"

export type AuditLogTargetType =
  | "organization"
  | "invite"
  | "membership"
  | "folder"
  | "document"
  | "document_version"
  | "submission"

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
  createdAt: string
}
