import { beforeEach, describe, expect, it, vi } from "vitest"

import { createAdminClient } from "@/lib/supabase/admin"
import {
  exportAuditLogs,
  listAuditLogPage,
  verifyAuditLogChain,
} from "@/services/audit-service"
import {
  POSTGREST_MAX_ROWS,
  PostgrestReadQuery,
} from "@/services/postgrest-fake.test-support"
import type { AuditLogAction } from "@/types/audit"

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}))

type FakeResult = {
  data: unknown
  error: Error | null
}

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

class QueuedQuery implements PromiseLike<FakeResult> {
  constructor(
    private readonly client: QueuedAdminClient,
    private readonly tableName: string
  ) {}

  select(): QueuedQuery {
    return this
  }

  eq(): QueuedQuery {
    return this
  }

  order(): QueuedQuery {
    return this
  }

  limit(): QueuedQuery {
    return this
  }

  async maybeSingle(): Promise<FakeResult> {
    return this.client.takeResult(this.tableName)
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.client.takeResult(this.tableName)).then(
      onfulfilled,
      onrejected
    )
  }
}

class QueuedAdminClient {
  readonly rpcCalls: Array<{
    functionName: string
    args: Record<string, unknown>
  }> = []

  constructor(
    private readonly results: Record<string, FakeResult[]>,
    private readonly rpcResults: Record<string, FakeResult[]> = {}
  ) {}

  from(tableName: string): QueuedQuery {
    return new QueuedQuery(this, tableName)
  }

  async rpc(
    functionName: string,
    args: Record<string, unknown>
  ): Promise<FakeResult> {
    this.rpcCalls.push({ functionName, args })
    const result = this.rpcResults[functionName]?.shift()

    if (!result) {
      throw new Error(`Missing queued RPC result for ${functionName}.`)
    }

    return result
  }

  takeResult(tableName: string): FakeResult {
    const result = this.results[tableName]?.shift()

    if (!result) {
      throw new Error(`Missing queued result for ${tableName}.`)
    }

    return result
  }
}

describe("verify audit log chain", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns the mapped verdict for an owner", async () => {
    const client = new QueuedAdminClient(
      {
        organization_memberships: [
          { data: { role: "owner_admin" }, error: null },
        ],
      },
      {
        verify_audit_log_chain: [
          {
            data: [
              {
                valid: false,
                checked_count: 41,
                first_invalid_seq: 42,
                failure_reason: "entry_hash_mismatch",
              },
            ],
            error: null,
          },
        ],
      }
    )
    vi.mocked(createAdminClient).mockReturnValue(client as never)

    const verification = await verifyAuditLogChain({
      actorUserId: "owner-1",
      organizationId: "org-1",
    })

    expect(verification).toEqual({
      valid: false,
      checkedCount: 41,
      firstInvalidSeq: 42,
      failureReason: "entry_hash_mismatch",
    })
    expect(client.rpcCalls).toEqual([
      {
        functionName: "verify_audit_log_chain",
        args: { target_org_id: "org-1" },
      },
    ])
  })

  it("rejects managers, who hold view but not verify", async () => {
    const client = new QueuedAdminClient({
      organization_memberships: [{ data: { role: "manager" }, error: null }],
    })
    vi.mocked(createAdminClient).mockReturnValue(client as never)

    await expect(
      verifyAuditLogChain({ actorUserId: "manager-1", organizationId: "org-1" })
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(client.rpcCalls).toEqual([])
  })

  it("surfaces a 500 when the database check errors", async () => {
    const client = new QueuedAdminClient(
      {
        organization_memberships: [
          { data: { role: "owner_admin" }, error: null },
        ],
      },
      {
        verify_audit_log_chain: [
          { data: null, error: new Error("verification unavailable") },
        ],
      }
    )
    vi.mocked(createAdminClient).mockReturnValue(client as never)

    await expect(
      verifyAuditLogChain({ actorUserId: "owner-1", organizationId: "org-1" })
    ).rejects.toMatchObject({ statusCode: 500 })
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
    entry_hash: "d".repeat(64),
    id: `audit-${seq}`,
    metadata: {},
    org_id: "org-1",
    prev_hash: seq === 1 ? null : "c".repeat(64),
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
    expect(page.entries[0]).toMatchObject({
      entryHash: "d".repeat(64),
      prevHash: null,
      seq: 1,
    })
  })

  it("rejects unknown audit actions returned by the database", async () => {
    await expect(
      listAuditLogPage(pageInput, {
        client: createEventClient([createEventRow(1, { action: "unknown" })]) as never,
      })
    ).rejects.toMatchObject({
      message: "Database returned an unsupported audit action.",
      statusCode: 500,
    })
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
