import { describe, expect, it } from "vitest"

import { formatAuditLogsAsCsv } from "@/services/audit-export-service"
import type { AuditLogEntry } from "@/types/audit"

const ENTRY: AuditLogEntry = {
  id: "log-1",
  organizationId: "org-1",
  actorUserId: "user-1",
  action: "document.finalized",
  targetType: "document",
  targetId: "doc-123",
  metadata: { revision: 2 },
  seq: 7,
  prevHash: "prev-hash",
  entryHash: "entry-hash",
  createdAt: "2026-07-30T12:00:00Z",
}

describe("formatAuditLogsAsCsv", () => {
  it("formats audit logs into RFC-4180 compliant CSV text", () => {
    const [header, row] = formatAuditLogsAsCsv([ENTRY]).split("\n")

    expect(header).toBe(
      '"Log ID","Sequence","Timestamp","Action","Actor User ID","Target Type","Target ID","Metadata"'
    )
    expect(row).toBe(
      '"log-1","7","2026-07-30T12:00:00Z","document.finalized","user-1","document","doc-123","{""revision"":2}"'
    )
  })

  // Regression: the export used to read target_resource_type, target_resource_id,
  // details and ip_address. None exist on audit_logs, so four of eight columns
  // were always empty while select("*") kept the query from erroring.
  it("populates every column from the real audit_logs shape", () => {
    const cells = formatAuditLogsAsCsv([ENTRY]).split("\n")[1]?.split(",")

    expect(cells).toHaveLength(8)
    expect(cells).not.toContain('""')
  })

  it("emits an empty cell for a system action with no actor or target", () => {
    const csv = formatAuditLogsAsCsv([
      { ...ENTRY, actorUserId: null, targetId: null, metadata: {} },
    ])

    expect(csv.split("\n")[1]).toBe(
      '"log-1","7","2026-07-30T12:00:00Z","document.finalized","","document","","{}"'
    )
  })

  it("returns a header-only document when an organization has no entries", () => {
    expect(formatAuditLogsAsCsv([]).split("\n")).toHaveLength(1)
  })
})
