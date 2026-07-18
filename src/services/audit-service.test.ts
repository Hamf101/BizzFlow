import { beforeEach, describe, expect, it, vi } from "vitest"

import { createAdminClient } from "@/lib/supabase/admin"
import { listAuditLogs } from "@/services/audit-service"
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
  constructor(private readonly results: Record<string, FakeResult[]>) {}

  from(tableName: string): QueuedQuery {
    return new QueuedQuery(this, tableName)
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
})
