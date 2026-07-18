import { afterEach, describe, expect, it, vi } from "vitest"

import {
  acceptInvite,
  getCurrentOrganizationContext,
  listOrganizationPeople,
  OrganizationServiceError,
  updateMemberRole,
} from "@/services/organization-service"

const originalEnv = { ...process.env }

type FakeError = { code: string; message: string }
type FakeResult = { data: unknown; error: FakeError | null }

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001"
const OWNER_ID = "20000000-0000-4000-8000-000000000001"
const MEMBER_ID = "20000000-0000-4000-8000-000000000002"
const OWNER_MEMBERSHIP_ID = "30000000-0000-4000-8000-000000000001"
const MEMBER_MEMBERSHIP_ID = "30000000-0000-4000-8000-000000000002"
const INVITE_ID = "40000000-0000-4000-8000-000000000001"
const INVITE_TOKEN = "private-invite-token"

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

  gt(): QueuedQuery {
    return this
  }

  in(): QueuedQuery {
    return this
  }

  order(): QueuedQuery {
    return this
  }

  async single(): Promise<FakeResult> {
    return this.client.takeTableResult(this.tableName)
  }

  async maybeSingle(): Promise<FakeResult> {
    return this.client.takeTableResult(this.tableName)
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.client.takeTableResult(this.tableName)).then(
      onfulfilled,
      onrejected
    )
  }
}

class QueuedAdminClient {
  readonly fromCalls: string[] = []
  readonly rpcCalls: Array<{
    functionName: string
    args: Record<string, unknown>
  }> = []

  constructor(
    private readonly tableResults: Record<string, FakeResult[]>,
    private readonly rpcResults: Record<string, FakeResult[]> = {}
  ) {}

  from(tableName: string): QueuedQuery {
    this.fromCalls.push(tableName)
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

  takeTableResult(tableName: string): FakeResult {
    const result = this.tableResults[tableName]?.shift()

    if (!result) {
      throw new Error(`Missing queued table result for ${tableName}.`)
    }

    return result
  }
}

describe("organization service setup failures", () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it("reports missing server credentials without logging a console error", async () => {
    process.env = {
      ...originalEnv,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    }

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})

    await expect(getCurrentOrganizationContext("user-id")).rejects.toMatchObject({
      message: "Supabase server credentials are not configured.",
      statusCode: 500,
    } satisfies Partial<OrganizationServiceError>)

    expect(warnSpy).toHaveBeenCalledWith(
      "organization_service_rejected",
      expect.objectContaining({
        operationName: "get_current_organization_context",
        reason: "Supabase server credentials are not configured.",
        statusCode: 500,
      })
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

describe("organization service atomic mutations", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("accepts an invite through the transactional RPC and verifies membership", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const client = new QueuedAdminClient(
      {
        invites: [{ data: createInviteRow(), error: null }],
        organization_memberships: [
          { data: createMembershipRow(MEMBER_MEMBERSHIP_ID, MEMBER_ID, "staff"), error: null },
        ],
        organizations: [{ data: createOrganizationRow(), error: null }],
      },
      {
        accept_organization_invite: [
          { data: MEMBER_MEMBERSHIP_ID, error: null },
        ],
      }
    )
    const recordAuditLog = vi.fn(async (): Promise<void> => {})

    const context = await acceptInvite(
      {
        userId: MEMBER_ID,
        userEmail: "MEMBER@example.com",
        token: INVITE_TOKEN,
      },
      { client: client as never, recordAuditLog }
    )

    expect(context.membership.id).toBe(MEMBER_MEMBERSHIP_ID)
    expect(client.rpcCalls).toEqual([
      {
        functionName: "accept_organization_invite",
        args: {
          target_invite_id: INVITE_ID,
          target_token: INVITE_TOKEN,
          target_user_id: MEMBER_ID,
          target_user_email: "member@example.com",
        },
      },
    ])
    expect(recordAuditLog).toHaveBeenCalledOnce()
  })

  it("updates a role through the locked RPC and verifies the returned row", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const client = new QueuedAdminClient(
      {
        organization_memberships: [
          {
            data: createMembershipRow(
              OWNER_MEMBERSHIP_ID,
              OWNER_ID,
              "owner_admin"
            ),
            error: null,
          },
          {
            data: createMembershipRow(MEMBER_MEMBERSHIP_ID, MEMBER_ID, "manager"),
            error: null,
          },
          {
            data: createMembershipRow(MEMBER_MEMBERSHIP_ID, MEMBER_ID, "staff"),
            error: null,
          },
        ],
      },
      {
        update_organization_member_role: [
          { data: MEMBER_MEMBERSHIP_ID, error: null },
        ],
      }
    )
    const recordAuditLog = vi.fn(async (): Promise<void> => {})

    const membership = await updateMemberRole(
      {
        actorUserId: OWNER_ID,
        organizationId: ORGANIZATION_ID,
        membershipId: MEMBER_MEMBERSHIP_ID,
        role: "staff",
      },
      { client: client as never, recordAuditLog }
    )

    expect(membership.role).toBe("staff")
    expect(client.rpcCalls[0]).toEqual({
      functionName: "update_organization_member_role",
      args: {
        target_org_id: ORGANIZATION_ID,
        target_membership_id: MEMBER_MEMBERSHIP_ID,
        target_actor_user_id: OWNER_ID,
        target_role: "staff",
      },
    })
  })

  it("preserves the last-owner user-safe error returned by the RPC", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const client = new QueuedAdminClient(
      {
        organization_memberships: [
          {
            data: createMembershipRow(
              OWNER_MEMBERSHIP_ID,
              OWNER_ID,
              "owner_admin"
            ),
            error: null,
          },
          {
            data: createMembershipRow(
              OWNER_MEMBERSHIP_ID,
              OWNER_ID,
              "owner_admin"
            ),
            error: null,
          },
        ],
      },
      {
        update_organization_member_role: [
          {
            data: null,
            error: {
              code: "23514",
              message: "The organization must keep one owner.",
            },
          },
        ],
      }
    )

    await expect(
      updateMemberRole(
        {
          actorUserId: OWNER_ID,
          organizationId: ORGANIZATION_ID,
          membershipId: OWNER_MEMBERSHIP_ID,
          role: "manager",
        },
        { client: client as never, recordAuditLog: async (): Promise<void> => {} }
      )
    ).rejects.toMatchObject({
      message: "The organization must keep one owner.",
      statusCode: 400,
    })
  })

  it("does not query or return pending invite tokens for staff", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const staffMembership = createMembershipRow(
      MEMBER_MEMBERSHIP_ID,
      MEMBER_ID,
      "staff"
    )
    const client = new QueuedAdminClient({
      organization_memberships: [
        { data: staffMembership, error: null },
        { data: [staffMembership], error: null },
      ],
      profiles: [
        {
          data: [{ id: MEMBER_ID, email: "member@example.com", full_name: null }],
          error: null,
        },
      ],
    })

    const people = await listOrganizationPeople(
      MEMBER_ID,
      ORGANIZATION_ID,
      { client: client as never }
    )

    expect(people.pendingInvites).toEqual([])
    expect(client.fromCalls).not.toContain("invites")
  })
})

function createMembershipRow(
  id: string,
  userId: string,
  role: "owner_admin" | "manager" | "staff" | "external_reviewer"
): Record<string, unknown> {
  return {
    id,
    org_id: ORGANIZATION_ID,
    user_id: userId,
    role,
    status: "active",
    created_at: "2026-07-17T20:00:00.000Z",
    updated_at: "2026-07-17T20:00:00.000Z",
  }
}

function createInviteRow(): Record<string, unknown> {
  return {
    id: INVITE_ID,
    org_id: ORGANIZATION_ID,
    email: "member@example.com",
    role: "staff",
    token: INVITE_TOKEN,
    status: "pending",
    expires_at: "2026-07-24T20:00:00.000Z",
    created_at: "2026-07-17T20:00:00.000Z",
  }
}

function createOrganizationRow(): Record<string, unknown> {
  return {
    id: ORGANIZATION_ID,
    name: "BizFlow Studio",
    slug: "bizflow-studio",
    created_by: OWNER_ID,
    created_at: "2026-07-17T20:00:00.000Z",
    updated_at: "2026-07-17T20:00:00.000Z",
  }
}
