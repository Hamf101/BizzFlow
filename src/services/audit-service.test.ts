import { afterEach, describe, expect, it } from "vitest"

import { type ErrorReportContext, setErrorReporter } from "@/lib/observability"

import {
  exportAuditLogs,
  listAuditLogPage,
  recordAuditLogBestEffort,
} from "@/services/audit-service"
import {
  POSTGREST_MAX_ROWS,
  PostgrestReadQuery,
} from "@/services/postgrest-fake.test-support"
import type { AuditLogAction } from "@/types/audit"

const SUBMISSION_AUDIT_ACTIONS: readonly AuditLogAction[] = [
  "submission.created",
  "submission.submitted",
  "submission.resubmitted",
  "submission.assigned",
  "submission.commented",
  "submission.changes_requested",
  "submission.approved",
  "submission.rejected",
  "submission.completed",
]

const PURGE_AUDIT_ACTIONS: readonly AuditLogAction[] = [
  "document.purged",
  "folder.purged",
]

describe("recordAuditLogBestEffort", () => {
  afterEach(() => {
    setErrorReporter(null)
  })

  it("reports a lost audit row to monitoring by its ids alone, and never fails the change it records", async () => {
    const reported: Array<[unknown, ErrorReportContext]> = []
    setErrorReporter((error, context) => reported.push([error, context]))
    const lost = new Error("insert failed")

    await expect(
      recordAuditLogBestEffort(
        {
          action: "invite.created",
          actorUserId: "user-1",
          metadata: { email: "ana@example.com" },
          organizationId: "org-1",
          targetId: "invite-1",
          targetType: "invite",
        },
        async () => {
          throw lost
        }
      )
    ).resolves.toBeUndefined()

    expect(reported).toEqual([
      [lost, { action: "invite.created", actorUserId: "user-1", operation: "audit_log", organizationId: "org-1", targetId: "invite-1" }],
    ])
  })
})

type AuditFakeRow = Record<string, unknown>

// Reads go through the shared PostgREST stand-in, which answers the way the
// real server does at its edges: a per-response row cap, and 416 (PGRST103)
// for a counted range that starts past the last matching row.
class AuditRowsClient {
  constructor(
    private readonly tables: Record<"audit_logs" | "organization_memberships", AuditFakeRow[]>,
    // A deployment may cap responses below the default 1,000 rows.
    private readonly maxRows: number = POSTGREST_MAX_ROWS
  ) {}

  from(tableName: "audit_logs" | "organization_memberships"): PostgrestReadQuery {
    return new PostgrestReadQuery(this.tables[tableName], this.maxRows)
  }
}

const MANAGER_MEMBERSHIP: AuditFakeRow = {
  org_id: "org-1",
  role: "manager",
  role_definition: { permissions: ["audit_logs:view"] },
  status: "active",
  user_id: "manager-1",
}
const NEWEST_FIRST = { direction: "desc", key: "created" } as const
const OLDEST_FIRST = { direction: "asc", key: "created" } as const

function createEventRow(seq: number, overrides: AuditFakeRow = {}): AuditFakeRow {
  return {
    action: "task.created",
    actor_user_id: "manager-1",
    created_at: new Date(Date.UTC(2026, 6, 18, 12) + seq * 60_000).toISOString(),
    id: `audit-${seq}`,
    metadata: {},
    org_id: "org-1",
    seq,
    target_id: null,
    target_type: "task",
    ...overrides,
  }
}

function createEventClient(
  events: AuditFakeRow[],
  membership: AuditFakeRow = MANAGER_MEMBERSHIP,
  maxRows?: number
): AuditRowsClient {
  return new AuditRowsClient(
    { audit_logs: events, organization_memberships: [membership] },
    maxRows
  )
}

function createEvents(count: number): AuditFakeRow[] {
  return Array.from({ length: count }, (_, index) => createEventRow(index + 1))
}

describe("list audit log pages", () => {
  const pageInput = {
    actorUserId: "manager-1",
    organizationId: "org-1",
    page: 1,
    pageSize: 50,
    sort: NEWEST_FIRST,
  }

  it("returns one page newest first with the tenant's total", async () => {
    const client = createEventClient([
      ...createEvents(5),
      createEventRow(6, { id: "audit-other", org_id: "org-2" }),
    ])

    const page = await listAuditLogPage(
      { ...pageInput, page: 2, pageSize: 2 },
      { client: client as never }
    )

    expect(page).toMatchObject({ page: 2, pageSize: 2, total: 5 })
    expect(page.entries.map((entry) => entry.seq)).toEqual([3, 2])
  })

  it("lists oldest first when asked", async () => {
    const page = await listAuditLogPage(
      { ...pageInput, pageSize: 3, sort: OLDEST_FIRST },
      { client: createEventClient(createEvents(5)) as never }
    )

    expect(page.entries.map((entry) => entry.seq)).toEqual([1, 2, 3])
  })

  it("counts only events about the chosen kinds of record", async () => {
    const client = createEventClient([
      createEventRow(1),
      createEventRow(2, { action: "document.created", target_type: "document" }),
      createEventRow(3, { action: "task_reminder.scheduled", target_type: "task_reminder" }),
      createEventRow(4, { action: "invite.created", target_type: "invite" }),
    ])

    const page = await listAuditLogPage(
      { ...pageInput, targetTypes: ["task", "task_reminder"] },
      { client: client as never }
    )

    expect(page.total).toBe(2)
    expect(page.entries.map((entry) => entry.seq)).toEqual([3, 1])
  })

  it("reports the true total for a stale page that starts past the end", async () => {
    const page = await listAuditLogPage(
      { ...pageInput, page: 5, pageSize: 2 },
      { client: createEventClient(createEvents(3)) as never }
    )

    expect(page).toEqual({ entries: [], page: 5, pageSize: 2, total: 3 })
  })

  it.each([
    ["page 0", { page: 0 }],
    ["a page beyond the last allowed", { page: 10_001 }],
    ["a page size of 0", { pageSize: 0 }],
    ["a page size above the limit", { pageSize: 201 }],
    ["an unknown sort key", { sort: { direction: "desc", key: "action" } }],
    ["an unknown direction", { sort: { direction: "sideways", key: "created" } }],
    ["an unknown sort key", { sort: { direction: "asc", key: "seq" } }],
    ["an unknown kind of record", { targetTypes: ["payment"] }],
  ])("rejects %s", async (_case, override) => {
    await expect(
      listAuditLogPage({ ...pageInput, ...override } as never, {
        client: createEventClient(createEvents(3)) as never,
      })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("maps every supported submission action and target", async () => {
    const client = createEventClient(
      SUBMISSION_AUDIT_ACTIONS.map((action: AuditLogAction, index: number) =>
        createEventRow(index + 1, { action, target_type: "submission" })
      )
    )

    const page = await listAuditLogPage(
      { ...pageInput, sort: OLDEST_FIRST },
      { client: client as never }
    )

    expect(page.entries.map((entry) => entry.action)).toEqual(SUBMISSION_AUDIT_ACTIONS)
    expect(page.entries.every((entry) => entry.targetType === "submission")).toBe(true)
    expect(page.entries[0]).toMatchObject({ seq: 1 })
  })

  it("keeps an action or target this build does not know instead of failing the whole log", async () => {
    const page = await listAuditLogPage(pageInput, {
      client: createEventClient([
        createEventRow(1, { action: "guest.invited", target_type: "guest_grant" }),
        createEventRow(2),
      ]) as never,
    })

    expect(page.entries.map((entry) => [entry.action, entry.targetType])).toEqual([
      [createEventRow(2).action, createEventRow(2).target_type],
      ["guest.invited", "guest_grant"],
    ])
  })

  it("maps immutable document and folder purge receipts", async () => {
    const client = createEventClient(
      PURGE_AUDIT_ACTIONS.map((action: AuditLogAction, index: number) =>
        createEventRow(index + 1, {
          action,
          metadata: { objectCount: index + 1, receiptId: `receipt-${index}` },
          target_type: action.startsWith("document") ? "document" : "folder",
        })
      )
    )

    const page = await listAuditLogPage(
      { ...pageInput, sort: OLDEST_FIRST },
      { client: client as never }
    )

    expect(page.entries.map((entry) => entry.action)).toEqual(PURGE_AUDIT_ACTIONS)
    expect(page.entries.map((entry) => entry.targetType)).toEqual([
      "document",
      "folder",
    ])
    expect(page.entries[0]?.metadata).toEqual({ objectCount: 1, receiptId: "receipt-0" })
  })

  it("rechecks edited audit permissions before each tenant read", async () => {
    const membership = {
      ...MANAGER_MEMBERSHIP,
      role_definition: { permissions: ["audit_logs:view"] as string[] },
    }
    const client = createEventClient([], membership)

    await expect(
      listAuditLogPage(pageInput, { client: client as never })
    ).resolves.toMatchObject({ entries: [], total: 0 })

    membership.role_definition.permissions = []

    await expect(
      listAuditLogPage(pageInput, { client: client as never })
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("export audit logs", () => {
  const exportInput = {
    actorUserId: "manager-1",
    organizationId: "org-1",
    sort: NEWEST_FIRST,
  }

  it("exports every matching event, newest first, across PostgREST's 1,000-row responses", async () => {
    const entries = await exportAuditLogs(exportInput, {
      client: createEventClient(createEvents(2_345)) as never,
    })

    expect(entries).toHaveLength(2_345)
    expect(entries[0]?.seq).toBe(2_345)
    expect(entries.at(-1)?.seq).toBe(1)
    expect(new Set(entries.map((entry) => entry.seq)).size).toBe(2_345)
  })

  it("exports everything even when the server caps responses below the batch size", async () => {
    const entries = await exportAuditLogs(exportInput, {
      client: createEventClient(createEvents(1_234), MANAGER_MEMBERSHIP, 300) as never,
    })

    expect(entries).toHaveLength(1_234)
    expect(new Set(entries.map((entry) => entry.seq)).size).toBe(1_234)
  })

  it("exports oldest first and only the chosen kinds of record", async () => {
    const client = createEventClient([
      createEventRow(1),
      createEventRow(2, { action: "document.created", target_type: "document" }),
      createEventRow(3),
    ])

    const entries = await exportAuditLogs(
      { ...exportInput, sort: OLDEST_FIRST, targetTypes: ["task"] },
      { client: client as never }
    )

    expect(entries.map((entry) => entry.seq)).toEqual([1, 3])
  })

  it("refuses an export larger than its limit instead of truncating it", async () => {
    await expect(
      exportAuditLogs(exportInput, {
        client: createEventClient(createEvents(101)) as never,
        maxExportEntries: 100,
      })
    ).rejects.toMatchObject({ statusCode: 413 })
  })

  it("rejects a member without the audit log permission", async () => {
    const client = createEventClient(createEvents(1), {
      ...MANAGER_MEMBERSHIP,
      role_definition: { permissions: [] },
    })

    await expect(
      exportAuditLogs(exportInput, { client: client as never })
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})
