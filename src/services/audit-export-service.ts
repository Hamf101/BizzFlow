import { formatCsv } from "@/lib/csv"
import type { AuditLogEntry } from "@/types/audit"

/**
 * Export columns, in output order.
 *
 * These mirror `public.audit_logs` exactly. There is deliberately no IP address
 * column: the table has never stored one, and the previous export emitted an
 * always-empty column that implied otherwise.
 */
const AUDIT_LOG_CSV_HEADERS = [
  "Log ID",
  "Sequence",
  "Timestamp",
  "Action",
  "Actor User ID",
  "Target Type",
  "Target ID",
  "Metadata",
] as const

/**
 * Generates an RFC-4180 CSV document from organization audit log entries.
 *
 * @param logs - Audit entries in the order they should appear.
 * @returns CSV text with a header row and one row per entry.
 */
export function formatAuditLogsAsCsv(logs: readonly AuditLogEntry[]): string {
  return formatCsv(
    AUDIT_LOG_CSV_HEADERS,
    logs.map((log: AuditLogEntry): readonly unknown[] => [
      log.id,
      log.seq,
      log.createdAt,
      log.action,
      log.actorUserId,
      log.targetType,
      log.targetId,
      log.metadata,
    ])
  )
}
