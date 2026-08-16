import { createAdminClient } from "@/lib/supabase/admin"

export type AuditLogEntry = {
  id: string
  organizationId: string
  actorUserId: string | null
  action: string
  targetResourceType: string | null
  targetResourceId: string | null
  details: Record<string, unknown> | null
  ipAddress: string | null
  createdAt: string
}

function escapeCsvField(field: unknown): string {
  if (field === null || field === undefined) return '""'
  const str = typeof field === "object" ? JSON.stringify(field) : String(field)
  return `"${str.replace(/"/g, '""')}"`
}

/**
 * Generates an RFC-4180 compliant CSV string from an array of audit log entries.
 */
export function formatAuditLogsAsCsv(logs: AuditLogEntry[]): string {
  const headers = [
    "Log ID",
    "Timestamp",
    "Action",
    "Actor User ID",
    "Target Resource Type",
    "Target Resource ID",
    "IP Address",
    "Details",
  ]

  const rows = logs.map((log) => [
    escapeCsvField(log.id),
    escapeCsvField(log.createdAt),
    escapeCsvField(log.action),
    escapeCsvField(log.actorUserId),
    escapeCsvField(log.targetResourceType),
    escapeCsvField(log.targetResourceId),
    escapeCsvField(log.ipAddress),
    escapeCsvField(log.details),
  ])

  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n")
}

/**
 * Fetches organization audit logs for display and CSV export.
 */
export async function getOrganizationAuditLogs(
  organizationId: string,
  limit = 100
): Promise<AuditLogEntry[]> {
  const client = createAdminClient()

  const { data, error } = await client
    .from("audit_logs")
    .select("*")
    .eq("org_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error || !data) {
    return []
  }

  return data.map((row) => ({
    id: row.id,
    organizationId: row.org_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    targetResourceType: typeof row.target_resource_type === "string" ? row.target_resource_type : null,
    targetResourceId: typeof row.target_resource_id === "string" ? row.target_resource_id : null,
    details: (row.details as Record<string, unknown> | null) ?? null,
    ipAddress: typeof row.ip_address === "string" ? row.ip_address : null,
    createdAt: row.created_at,
  }))
}
