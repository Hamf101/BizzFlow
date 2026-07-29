import { beforeEach, describe, expect, it, vi } from "vitest"

import { createAdminClient } from "@/lib/supabase/admin"
import { listAuditLogs, verifyAuditLogChain } from "@/services/audit-service"
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

function createAuditRow(action: AuditLogAction, index: number): Record<string, unknown> {
  return {
    id: `audit-${index}`,
    org_id: "org-1",
    actor_user_id: "manager-1",
    action,
    target_type: "submission",
    target_id: "submission-1",
    metadata: { revision: index + 1 },
    seq: index + 1,
    prev_hash: index === 0 ? null : "c".repeat(64),
    entry_hash: "d".repeat(64),
    created_at: `2026-07-18T12:${String(index).padStart(2, "0")}:00.000Z`,
  }
}

describe("list audit logs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("maps every supported submission action and target", async () => {
    const client = new QueuedAdminClient({
      organization_memberships: [
        {
          data: { role: "manager" },
          error: null,
        },
      ],
      audit_logs: [
        {
          data: SUBMISSION_AUDIT_ACTIONS.map(createAuditRow),
          error: null,
        },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(client as never)

    const entries = await listAuditLogs({
      actorUserId: "manager-1",
      organizationId: "org-1",
    })

    expect(entries.map((entry) => entry.action)).toEqual(SUBMISSION_AUDIT_ACTIONS)
    expect(entries.every((entry) => entry.targetType === "submission")).toBe(true)
    expect(entries[0]).toMatchObject({
      seq: 1,
      prevHash: null,
      entryHash: "d".repeat(64),
    })
  })

  it("rejects unknown audit actions returned by the database", async () => {
    const client = new QueuedAdminClient({
      organization_memberships: [
        {
          data: { role: "manager" },
          error: null,
        },
      ],
      audit_logs: [
        {
          data: [{ ...createAuditRow("submission.created", 0), action: "unknown" }],
          error: null,
        },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(client as never)

    await expect(
      listAuditLogs({
        actorUserId: "manager-1",
        organizationId: "org-1",
      })
    ).rejects.toMatchObject({
      message: "Database returned an unsupported audit action.",
      statusCode: 500,
    })
  })

  it("maps immutable document and folder purge receipts", async () => {
    const client = new QueuedAdminClient({
      organization_memberships: [
        {
          data: { role: "owner_admin" },
          error: null,
        },
      ],
      audit_logs: [
        {
          data: PURGE_AUDIT_ACTIONS.map(
            (action: AuditLogAction, index: number) => ({
              ...createAuditRow(action, index),
              target_type: action.startsWith("document")
                ? "document"
                : "folder",
              metadata: {
                receiptId: `receipt-${index}`,
                objectCount: index + 1,
              },
            })
          ),
          error: null,
        },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(client as never)

    const entries = await listAuditLogs({
      actorUserId: "owner-1",
      organizationId: "org-1",
    })

    expect(entries.map((entry) => entry.action)).toEqual(PURGE_AUDIT_ACTIONS)
    expect(entries.map((entry) => entry.targetType)).toEqual([
      "document",
      "folder",
    ])
    expect(entries[0]?.metadata).toEqual({
      receiptId: "receipt-0",
      objectCount: 1,
    })
  })
})

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
