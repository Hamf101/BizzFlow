import { vi } from "vitest"

import type { OrganizationRole } from "@/lib/permissions"
import {
  PostgrestReadQuery,
  type PostgrestFakeResult,
} from "@/services/postgrest-fake.test-support"
import type { TaskServiceDeps } from "@/services/task-service"

/** Tenant identifier shared by every task fixture. */
export const ORG_ID = "10000000-0000-4000-8000-000000000001"
/** Second tenant used to prove cross-tenant isolation. */
export const OTHER_ORG_ID = "10000000-0000-4000-8000-000000000002"
/** Owner-admin actor identifier. */
export const OWNER_ID = "20000000-0000-4000-8000-000000000001"
/** Manager actor identifier. */
export const MANAGER_ID = "20000000-0000-4000-8000-000000000002"
/** Staff actor identifier. */
export const STAFF_ID = "20000000-0000-4000-8000-000000000003"
/** External-reviewer actor identifier. */
export const REVIEWER_ID = "20000000-0000-4000-8000-000000000004"
/** Actor with no membership in either tenant. */
export const OUTSIDER_ID = "20000000-0000-4000-8000-000000000005"
/** Seeded task identifier. */
export const TASK_ID = "30000000-0000-4000-8000-000000000001"
/** Identifier returned by the deterministic id generator for new tasks. */
export const NEW_TASK_ID = "30000000-0000-4000-8000-000000000009"
/** Seeded submission identifier. */
export const SUBMISSION_ID = "40000000-0000-4000-8000-000000000001"
/** Seeded reminder identifier. */
export const REMINDER_ID = "50000000-0000-4000-8000-000000000001"
/** Identifier returned by the deterministic id generator for new reminders. */
export const NEW_REMINDER_ID = "50000000-0000-4000-8000-000000000009"
/** Frozen creation instant for seeded rows. */
export const CREATED_AT = "2026-07-29T09:00:00.000Z"
/** Frozen instant returned by the injected clock. */
export const NOW = "2026-07-30T12:00:00.000Z"
/** Instant that is already due relative to the injected clock. */
export const PAST_AT = "2026-07-30T11:00:00.000Z"
/** Instant that is still in the future relative to the injected clock. */
export const FUTURE_AT = "2026-07-31T09:00:00.000Z"

/** Loosely typed in-memory database row. */
export type FakeRow = Record<string, unknown>

type FakeTableName =
  | "organization_memberships"
  | "organizations"
  | "notification_deliveries"
  | "profiles"
  | "submissions"
  | "tasks"
  | "task_reminders"

type FakeTables = Record<FakeTableName, FakeRow[]>

/**
 * In-memory Supabase client used by the task service tests.
 */
export class FakeSupabaseClient {
  readonly tables: FakeTables
  private readonly updateHooks = new Map<FakeTableName, Array<() => void>>()

  constructor(seed: Partial<FakeTables> = {}) {
    this.tables = {
      organization_memberships: seed.organization_memberships ?? [],
      // Both switches default on, matching the migration default, so a test
      // that does not care about organization settings behaves as before.
      organizations: seed.organizations ?? [
        {
          id: ORG_ID,
          email_notifications_enabled: true,
          sms_notifications_enabled: true,
        },
      ],
      notification_deliveries: seed.notification_deliveries ?? [],
      profiles: seed.profiles ?? [],
      submissions: seed.submissions ?? [],
      tasks: seed.tasks ?? [],
      task_reminders: seed.task_reminders ?? [],
    }
  }

  /**
   * Starts an in-memory query for a supported task table.
   *
   * @param tableName - Table to query.
   * @returns Chainable fake query builder.
   */
  from(tableName: FakeTableName): FakeQueryBuilder {
    return new FakeQueryBuilder(this, tableName)
  }

  /**
   * Registers a concurrent writer that runs before the next update executes.
   *
   * This is how the tests reproduce a lost-update race without timing tricks.
   *
   * @param tableName - Table the racing writer touches.
   * @param mutate - Concurrent mutation applied to the seeded rows.
   */
  onNextUpdate(tableName: FakeTableName, mutate: () => void): void {
    const hooks = this.updateHooks.get(tableName) ?? []
    hooks.push(mutate)
    this.updateHooks.set(tableName, hooks)
  }

  /**
   * Runs and consumes the next registered concurrent writer, if any.
   *
   * @param tableName - Table the update targets.
   */
  runNextUpdateHook(tableName: FakeTableName): void {
    this.updateHooks.get(tableName)?.shift()?.()
  }
}

class FakeQueryBuilder extends PostgrestReadQuery {
  private insertRows: FakeRow[] | null = null
  private updateValues: FakeRow | null = null

  constructor(
    private readonly client: FakeSupabaseClient,
    private readonly tableName: FakeTableName
  ) {
    super(client.tables[tableName])
  }

  insert(value: FakeRow | FakeRow[]): this {
    this.insertRows = Array.isArray(value) ? value : [value]
    return this
  }

  update(value: FakeRow): this {
    this.updateValues = value
    return this
  }

  // Reads are the shared PostgREST stand-in's; only writes are task-specific.
  protected override execute(): PostgrestFakeResult {
    if (this.insertRows) {
      return this.executeInsert(this.insertRows)
    }

    if (this.updateValues) {
      this.client.runNextUpdateHook(this.tableName)
      const matchingRows = this.matchingRows()
      const values = this.updateValues
      matchingRows.forEach((row: FakeRow): void => {
        Object.assign(row, values)
      })
      return { count: null, data: matchingRows, error: null }
    }

    return super.execute()
  }

  private executeInsert(rows: FakeRow[]): PostgrestFakeResult {
    const conflict = rows.find((row: FakeRow): boolean =>
      this.hasUniqueConflict(row)
    )

    if (conflict) {
      return {
        count: null,
        data: [],
        error: {
          code: "23505",
          message: "duplicate key value violates unique constraint",
        },
      }
    }

    this.client.tables[this.tableName].push(...rows)
    return { count: null, data: rows, error: null }
  }

  private hasUniqueConflict(row: FakeRow): boolean {
    if (this.tableName !== "task_reminders") {
      return false
    }

    return this.client.tables.task_reminders.some(
      (existing: FakeRow): boolean =>
        existing.task_id === row.task_id &&
        existing.recipient_user_id === row.recipient_user_id &&
        existing.remind_at === row.remind_at
    )
  }
}

/**
 * Builds an active organization membership fixture.
 *
 * @param role - Organization role for the member.
 * @param overrides - Values that replace the default membership fixture.
 * @returns Membership database row.
 */
export function createMembershipRow(
  role: OrganizationRole,
  overrides: FakeRow = {}
): FakeRow {
  return {
    id: `membership-${role}`,
    org_id: ORG_ID,
    user_id: MANAGER_ID,
    role,
    status: "active",
    email_notifications_enabled: true,
    sms_notifications_enabled: true,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  }
}

/**
 * Builds the standard four-role membership set for the primary tenant.
 *
 * @returns Membership rows for owner, manager, staff, and reviewer actors.
 */
export function createMembershipRows(): FakeRow[] {
  return [
    createMembershipRow("owner_admin", { user_id: OWNER_ID }),
    createMembershipRow("manager", { user_id: MANAGER_ID }),
    createMembershipRow("staff", { user_id: STAFF_ID }),
    createMembershipRow("external_reviewer", { user_id: REVIEWER_ID }),
  ]
}

/**
 * Builds a profile fixture for a task recipient.
 *
 * @param overrides - Values that replace the default profile fixture.
 * @returns Profile database row.
 */
export function createProfileRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: STAFF_ID,
    email: "staff@example.com",
    full_name: "Sam Staff",
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  }
}

/**
 * Builds a task fixture with optional overrides.
 *
 * @param overrides - Values that replace the default task fixture.
 * @returns Task database row.
 */
export function createTaskRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: TASK_ID,
    org_id: ORG_ID,
    title: "Collect signed lease",
    description: null,
    status: "open",
    due_at: FUTURE_AT,
    assigned_to: null,
    assigned_by: null,
    assigned_at: null,
    submission_id: null,
    created_by: MANAGER_ID,
    updated_by: MANAGER_ID,
    completed_at: null,
    revision: 1,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  }
}

/**
 * Builds a task reminder fixture with optional overrides.
 *
 * @param overrides - Values that replace the default reminder fixture.
 * @returns Task reminder database row.
 */
export function createTaskReminderRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: REMINDER_ID,
    org_id: ORG_ID,
    task_id: TASK_ID,
    recipient_user_id: STAFF_ID,
    remind_at: PAST_AT,
    channel: "email",
    origin: "manual",
    status: "pending",
    attempt_count: 0,
    last_error: null,
    sent_at: null,
    created_by: MANAGER_ID,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  }
}

/**
 * Builds a submission fixture that a task can be created from.
 *
 * @param overrides - Values that replace the default submission fixture.
 * @returns Submission database row.
 */
export function createSubmissionRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: SUBMISSION_ID,
    org_id: ORG_ID,
    title: "Onboarding form",
    status: "submitted",
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  }
}

/**
 * Creates injectable task service dependencies backed by the fake client.
 *
 * @param client - In-memory Supabase client.
 * @param ids - Deterministic identifiers returned in order.
 * @returns Task service dependency overrides.
 */
export function createDeps(
  client: FakeSupabaseClient,
  ids: string[] = []
): Required<
  Pick<
    TaskServiceDeps,
    | "client"
    | "createId"
    | "now"
    | "recordAuditLog"
    | "sendTaskEmail"
    | "sendSms"
    | "publishTaskAssigned"
    | "recordNotificationDelivery"
  >
> {
  const idQueue = [...ids]
  let generatedIdCount = 0

  return {
    client: client as never,
    createId: (): string => {
      generatedIdCount += 1
      return (
        idQueue.shift() ??
        `90000000-0000-4000-8000-${String(generatedIdCount).padStart(12, "0")}`
      )
    },
    now: (): Date => new Date(NOW),
    recordAuditLog: vi.fn().mockResolvedValue(undefined),
    sendTaskEmail: vi.fn().mockResolvedValue(undefined),
    // A real provider resolves a SendSmsResult; resolving undefined would make
    // every success path read `.success` off undefined.
    sendSms: vi.fn().mockResolvedValue({ success: true, messageId: "sms-1" }),
    publishTaskAssigned: vi.fn().mockResolvedValue(undefined),
    recordNotificationDelivery: vi.fn().mockResolvedValue(null),
  }
}
