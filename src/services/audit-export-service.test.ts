import { describe, expect, it } from "vitest"

import { formatAuditLogsAsCsv, type AuditLogEntry } from "./audit-export-service"

describe("audit-export-service", () => {
  it("formats audit logs into RFC-4180 compliant CSV text", () => {
    const mockLogs: AuditLogEntry[] = [
      {
        id: "log-1",
        organizationId: "org-1",
        actorUserId: "user-1",
        action: "document.published",
        targetResourceType: "document",
        targetResourceId: "doc-123",
        details: { revision: 2 },
        ipAddress: "127.0.0.1",
        createdAt: "2026-07-30T12:00:00Z",
      },
    ]

    const csv = formatAuditLogsAsCsv(mockLogs)
    expect(csv).toContain("Log ID,Timestamp,Action")
    expect(csv).toContain('"log-1"')
    expect(csv).toContain('"document.published"')
    expect(csv).toContain('"user-1"')
  })
})
