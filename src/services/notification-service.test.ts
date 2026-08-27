import { describe, expect, it, vi } from "vitest"

import {
  getOrganizationNotificationSettings,
  recordNotificationDelivery,
  updateOrganizationNotificationSettings,
} from "@/services/notification-service"
import { isNotificationChannelEnabled } from "@/types/notification"

// Production callers pass no deps, so the only way to prove the audit event
// actually fires is to watch the module the service falls back to.
const recordAuditLogSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock("@/services/audit-service", () => ({
  recordAuditLog: recordAuditLogSpy,
}))

const ORG_ID = "10000000-0000-4000-8000-000000000001"
const OWNER_ID = "20000000-0000-4000-8000-000000000001"
const MANAGER_ID = "20000000-0000-4000-8000-000000000002"
const DELIVERY_ID = "30000000-0000-4000-8000-000000000001"
const NOW = "2026-08-01T09:00:00.000Z"

type FakeRow = Record<string, unknown>

/** Minimal in-memory client covering the two relations this service touches. */
class FakeClient {
  readonly tables: { organizations: FakeRow[]; notification_deliveries: FakeRow[] }
  readonly memberships: FakeRow[]

  constructor(seed: {
    organizations?: FakeRow[]
    notification_deliveries?: FakeRow[]
    memberships?: FakeRow[]
  } = {}) {
    this.tables = {
      organizations: seed.organizations ?? [],
      notification_deliveries: seed.notification_deliveries ?? [],
    }
    this.memberships = seed.memberships ?? []
  }

  from(tableName: string): FakeQuery {
    if (tableName === "organization_memberships") {
      return new FakeQuery(this.memberships)
    }

    if (tableName === "organizations") {
      return new FakeQuery(this.tables.organizations)
    }

    if (tableName === "notification_deliveries") {
      return new FakeQuery(this.tables.notification_deliveries)
    }

    throw new Error(`Unexpected relation "${tableName}".`)
  }
}

class FakeQuery implements PromiseLike<{ data: FakeRow[]; error: null }> {
  private readonly filters: Array<(row: FakeRow) => boolean> = []
  private inserted: FakeRow[] | null = null
  private updateValues: FakeRow | null = null

  constructor(private readonly rows: FakeRow[]) {}

  select(): this {
    return this
  }

  insert(values: FakeRow): this {
    this.inserted = [{ ...values }]
    return this
  }

  update(values: FakeRow): this {
    this.updateValues = values
    return this
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value)
    return this
  }

  in(column: string, values: readonly unknown[]): this {
    this.filters.push((row) => values.includes(row[column]))
    return this
  }

  order(): this {
    return this
  }

  limit(): this {
    return this
  }

  async maybeSingle(): Promise<{ data: FakeRow | null; error: null }> {
    const rows = this.run()
    return { data: rows[0] ?? null, error: null }
  }

  then<TResult1 = { data: FakeRow[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: FakeRow[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.run(), error: null as null }).then(
      onfulfilled,
      onrejected
    )
  }

  private run(): FakeRow[] {
    if (this.inserted) {
      this.rows.push(...this.inserted)
      return this.inserted
    }

    const matched = this.rows.filter((row) =>
      this.filters.every((predicate) => predicate(row))
    )

    if (this.updateValues) {
      for (const row of matched) Object.assign(row, this.updateValues)
    }

    return matched
  }
}

function createDeps(client: FakeClient) {
  return {
    client: client as never,
    createId: () => DELIVERY_ID,
    now: () => new Date(NOW),
    recordAuditLog: vi.fn().mockResolvedValue(undefined),
  }
}

describe("isNotificationChannelEnabled", () => {
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])(
    "org=%s member=%s resolves to %s",
    (organizationEnabled, memberEnabled, expected) => {
      // The organization switch gates the member preference; a member cannot
      // re-enable a channel the organization turned off.
      expect(
        isNotificationChannelEnabled({ organizationEnabled, memberEnabled })
      ).toBe(expected)
    }
  )
})

describe("recordNotificationDelivery", () => {
  it("stores a sent delivery and writes the matching audit event", async () => {
    const client = new FakeClient()
    const deps = createDeps(client)

    const delivery = await recordNotificationDelivery(
      {
        organizationId: ORG_ID,
        recipientUserId: OWNER_ID,
        channel: "email",
        purpose: "task_assigned",
        reference: "task-assigned/1",
        status: "sent",
      },
      deps
    )

    expect(delivery).toMatchObject({ status: "sent", channel: "email" })
    expect(deps.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "notification.sent",
        targetType: "notification",
        actorUserId: null,
      })
    )
  })

  // Regression: emission used to be wrapped in `if (deps.recordAuditLog)` with
  // no fallback. Every production call site passes a single argument, so deps
  // was always {} and notification.sent/.failed/.suppressed never reached the
  // audit log — while tests, which inject a fake, all passed.
  it("writes the audit event when no recordAuditLog dependency is injected", async () => {
    recordAuditLogSpy.mockClear()
    const client = new FakeClient()

    await recordNotificationDelivery(
      {
        organizationId: ORG_ID,
        recipientUserId: OWNER_ID,
        channel: "sms",
        purpose: "task_assigned",
        reference: "task-assigned/2",
        status: "suppressed",
      },
      { client: client as never, createId: () => DELIVERY_ID, now: () => new Date(NOW) }
    )

    expect(recordAuditLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "notification.suppressed",
        organizationId: ORG_ID,
        targetType: "notification",
      })
    )
  })

  it("keeps a delivery that was written when the audit write fails", async () => {
    recordAuditLogSpy.mockClear()
    recordAuditLogSpy.mockRejectedValueOnce(new Error("audit chain unavailable"))
    const client = new FakeClient()

    const delivery = await recordNotificationDelivery(
      {
        organizationId: ORG_ID,
        recipientUserId: OWNER_ID,
        channel: "email",
        purpose: "task_assigned",
        reference: "task-assigned/3",
        status: "sent",
      },
      { client: client as never, createId: () => DELIVERY_ID, now: () => new Date(NOW) }
    )

    expect(delivery).toMatchObject({ status: "sent" })
    expect(client.tables.notification_deliveries).toHaveLength(1)
  })

  it("stores no message content, phone number, or email address", async () => {
    const client = new FakeClient()

    await recordNotificationDelivery(
      {
        organizationId: ORG_ID,
        recipientUserId: OWNER_ID,
        channel: "sms",
        purpose: "task_reminder",
        reference: "task-reminder/1",
        status: "sent",
      },
      createDeps(client)
    )

    const stored = JSON.stringify(client.tables.notification_deliveries[0])
    expect(stored).not.toMatch(/@/)
    expect(stored).not.toMatch(/\+\d{6,}/)
  })

  it("supplies a reason for a failure the caller did not describe", async () => {
    // The check constraint requires last_error on a failed row.
    const client = new FakeClient()

    await recordNotificationDelivery(
      {
        organizationId: ORG_ID,
        recipientUserId: OWNER_ID,
        channel: "sms",
        purpose: "task_assigned",
        reference: "task-assigned-sms/1",
        status: "failed",
      },
      createDeps(client)
    )

    expect(client.tables.notification_deliveries[0].last_error).toBe(
      "Notification delivery failed."
    )
  })

  it("clears the failure reason on a suppressed delivery", async () => {
    const client = new FakeClient()

    await recordNotificationDelivery(
      {
        organizationId: ORG_ID,
        recipientUserId: OWNER_ID,
        channel: "email",
        purpose: "task_reminder",
        reference: "task-reminder/2",
        status: "suppressed",
        lastError: "should be dropped",
      },
      createDeps(client)
    )

    expect(client.tables.notification_deliveries[0].last_error).toBeNull()
    expect(client.tables.notification_deliveries[0].status).toBe("suppressed")
  })

  it("never fails the caller when the bookkeeping write breaks", async () => {
    // A notification that genuinely went out must not be reported as failed
    // because the audit row could not be stored afterwards.
    const brokenClient = {
      from: () => {
        throw new Error("connection lost")
      },
    }
    vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(
      recordNotificationDelivery(
        {
          organizationId: ORG_ID,
          recipientUserId: OWNER_ID,
          channel: "email",
          purpose: "task_assigned",
          reference: "task-assigned/9",
          status: "sent",
        },
        { client: brokenClient as never }
      )
    ).resolves.toBeNull()
  })
})

describe("organization notification settings", () => {
  it("reads the stored switches", async () => {
    const client = new FakeClient({
      organizations: [
        {
          id: ORG_ID,
          email_notifications_enabled: true,
          sms_notifications_enabled: false,
        },
      ],
    })

    await expect(
      getOrganizationNotificationSettings(ORG_ID, createDeps(client))
    ).resolves.toEqual({
      emailNotificationsEnabled: true,
      smsNotificationsEnabled: false,
    })
  })

  it("defaults to enabled when the organization row is missing", async () => {
    // Failing open matters: an unreadable settings row must not silently stop
    // every notification in the tenant.
    vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(
      getOrganizationNotificationSettings(ORG_ID, createDeps(new FakeClient()))
    ).resolves.toEqual({
      emailNotificationsEnabled: true,
      smsNotificationsEnabled: true,
    })
  })

  it("lets an owner change the switches", async () => {
    const client = new FakeClient({
      organizations: [
        {
          id: ORG_ID,
          email_notifications_enabled: true,
          sms_notifications_enabled: true,
        },
      ],
      memberships: [
        { org_id: ORG_ID, user_id: OWNER_ID, role: "owner_admin", status: "active" },
      ],
    })

    await expect(
      updateOrganizationNotificationSettings(
        {
          actorUserId: OWNER_ID,
          organizationId: ORG_ID,
          emailNotificationsEnabled: true,
          smsNotificationsEnabled: false,
        },
        createDeps(client)
      )
    ).resolves.toEqual({
      emailNotificationsEnabled: true,
      smsNotificationsEnabled: false,
    })
  })

  it("refuses a manager", async () => {
    const client = new FakeClient({
      organizations: [{ id: ORG_ID, email_notifications_enabled: true, sms_notifications_enabled: true }],
      memberships: [
        { org_id: ORG_ID, user_id: MANAGER_ID, role: "manager", status: "active" },
      ],
    })

    await expect(
      updateOrganizationNotificationSettings(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          emailNotificationsEnabled: false,
          smsNotificationsEnabled: false,
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it("refuses a non-member", async () => {
    const client = new FakeClient({
      organizations: [{ id: ORG_ID, email_notifications_enabled: true, sms_notifications_enabled: true }],
    })

    await expect(
      updateOrganizationNotificationSettings(
        {
          actorUserId: OWNER_ID,
          organizationId: ORG_ID,
          emailNotificationsEnabled: false,
          smsNotificationsEnabled: false,
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})
