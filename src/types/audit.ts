export type AuditLogAction =
  | "organization.created"
  | "invite.created"
  | "invite.accepted"
  | "membership.role_updated"

export type AuditLogTargetType = "organization" | "invite" | "membership"

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
