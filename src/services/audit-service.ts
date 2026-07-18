import { createAdminClient } from "@/lib/supabase/admin"
import {
  canPerformOrganizationAction,
  isOrganizationRole,
  type OrganizationRole,
} from "@/lib/permissions"
import type {
  AuditLogAction,
  AuditLogEntry,
  AuditLogTargetType,
  AuditMetadata,
} from "@/types/audit"

type AdminClient = ReturnType<typeof createAdminClient>

type AuditLogRow = {
  id: string
  org_id: string
  actor_user_id: string | null
  action: string
  target_type: string
  target_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

type MembershipRow = {
  role: string
}

type RecordAuditLogInput = {
  organizationId: string
  actorUserId: string | null
  action: AuditLogAction
  targetType: AuditLogTargetType
  targetId?: string | null
  metadata?: AuditMetadata
}

type ListAuditLogsInput = {
  actorUserId: string
  organizationId: string
  limit?: number
}

/**
 * Error type raised by audit log service operations.
 */
export class AuditServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates an audit service error with an HTTP-style status code.
   *
   * @param message - User-safe error message.
   * @param statusCode - HTTP-style status code for route/action translation.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "AuditServiceError"
    this.statusCode = statusCode
  }
}

/**
 * Records an audit event through the trusted admin client.
 *
 * @param input - Organization, actor, target, and metadata for the event.
 * @returns Created audit log entry.
 * @throws AuditServiceError when the audit event cannot be written.
 */
export async function recordAuditLog(
  input: RecordAuditLogInput
): Promise<AuditLogEntry> {
  const startedAt = Date.now()

  try {
    const client = createAdminClient()
    const { data, error } = await client
      .from("audit_logs")
      .insert({
        org_id: input.organizationId,
        actor_user_id: input.actorUserId,
        action: input.action,
        target_type: input.targetType,
        target_id: input.targetId ?? null,
        metadata: input.metadata ?? {},
      })
      .select("id,org_id,actor_user_id,action,target_type,target_id,metadata,created_at")
      .single()

    if (error || !data) {
      throw new AuditServiceError("Unable to record audit event.", 500)
    }

    console.info("audit_log_recorded", {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      durationMs: Date.now() - startedAt,
    })

    return mapAuditLog(data as AuditLogRow)
  } catch (error: unknown) {
    if (error instanceof AuditServiceError) {
      console.warn("audit_log_rejected", {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: input.action,
        reason: error.message,
        statusCode: error.statusCode,
        durationMs: Date.now() - startedAt,
      })
      throw error
    }

    console.error("audit_log_failed", {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      reason: error instanceof Error ? error.message : "Unknown audit error",
      durationMs: Date.now() - startedAt,
    })
    throw new AuditServiceError("Audit service failed.", 500)
  }
}

/**
 * Lists audit events visible to an organization member.
 *
 * @param input - Actor, organization, and optional result limit.
 * @returns Recent audit log entries.
 * @throws AuditServiceError when the actor lacks permission or logs cannot be read.
 */
export async function listAuditLogs(
  input: ListAuditLogsInput
): Promise<AuditLogEntry[]> {
  const client = createAdminClient()
  const actorRole = await getOrganizationRole(
    client,
    input.organizationId,
    input.actorUserId
  )

  if (!actorRole || !canPerformOrganizationAction(actorRole, "audit_logs:view")) {
    throw new AuditServiceError("You cannot view audit logs.", 403)
  }

  const { data, error } = await client
    .from("audit_logs")
    .select("id,org_id,actor_user_id,action,target_type,target_id,metadata,created_at")
    .eq("org_id", input.organizationId)
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 50)

  if (error || !data) {
    throw new AuditServiceError("Unable to load audit logs.", 500)
  }

  return (data as AuditLogRow[]).map(mapAuditLog)
}

async function getOrganizationRole(
  client: AdminClient,
  organizationId: string,
  userId: string
): Promise<OrganizationRole | null> {
  const { data, error } = await client
    .from("organization_memberships")
    .select("role")
    .eq("org_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle()

  if (error) {
    throw new AuditServiceError("Unable to load audit permissions.", 500)
  }

  if (!data) {
    return null
  }

  const row = data as MembershipRow

  if (!isOrganizationRole(row.role)) {
    throw new AuditServiceError("Database returned an unsupported role.", 500)
  }

  return row.role
}

function mapAuditLog(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    organizationId: row.org_id,
    actorUserId: row.actor_user_id,
    action: parseAuditLogAction(row.action),
    targetType: parseAuditLogTargetType(row.target_type),
    targetId: row.target_id,
    metadata: parseAuditMetadata(row.metadata),
    createdAt: row.created_at,
  }
}

function parseAuditLogAction(value: string): AuditLogAction {
  if (
    value === "organization.created" ||
    value === "invite.created" ||
    value === "invite.accepted" ||
    value === "membership.role_updated" ||
    value === "folder.created" ||
    value === "folder.archived" ||
    value === "document.created" ||
    value === "document.archived" ||
    value === "document.finalized" ||
    value === "document_version.created" ||
    value === "document_version.download_url_issued"
  ) {
    return value
  }

  throw new AuditServiceError("Database returned an unsupported audit action.", 500)
}

function parseAuditLogTargetType(value: string): AuditLogTargetType {
  if (
    value === "organization" ||
    value === "invite" ||
    value === "membership" ||
    value === "folder" ||
    value === "document" ||
    value === "document_version"
  ) {
    return value
  }

  throw new AuditServiceError("Database returned an unsupported audit target.", 500)
}

function parseAuditMetadata(value: Record<string, unknown>): AuditMetadata {
  const metadata: AuditMetadata = {}

  Object.entries(value).forEach(([key, entryValue]: [string, unknown]) => {
    if (
      typeof entryValue === "string" ||
      typeof entryValue === "number" ||
      typeof entryValue === "boolean" ||
      entryValue === null
    ) {
      metadata[key] = entryValue
    }
  })

  return metadata
}
