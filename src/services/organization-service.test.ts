import { afterEach, describe, expect, it, vi } from "vitest"

import { getOrganizationRolePermissions } from "@/lib/permissions"
import {
  acceptInvite,
  archiveOrganizationRole,
  createInvite,
  createOrganizationRole,
  getCurrentOrganizationContext,
  getMemberSettings,
  listOrganizationPeople,
  OrganizationServiceError,
  revokeInvite,
  updateMemberAccess,
  updateMemberRole,
  updateOrganizationRole,
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
const MANAGER_ROLE_ID = "50000000-0000-4000-8000-000000000001"
const CUSTOM_ROLE_ID = "50000000-0000-4000-8000-000000000002"

class QueuedQuery implements PromiseLike<FakeResult> {
  constructor(
    private readonly client: QueuedAdminClient,
    private readonly tableName: string
  ) {}

  select(): QueuedQuery {
    return this
  }

  insert(values: Record<string, unknown>): QueuedQuery {
    this.client.queryCalls.push({
      kind: "insert",
      tableName: this.tableName,
      values,
    })
    return this
  }

  update(values: Record<string, unknown>): QueuedQuery {
    this.client.queryCalls.push({
      kind: "update",
      tableName: this.tableName,
      values,
    })
    return this
  }

  eq(column: string, value: unknown): QueuedQuery {
    this.client.queryCalls.push({
      column,
      kind: "filter",
      tableName: this.tableName,
      value,
    })
    return this
  }

  gt(): QueuedQuery {
    return this
  }

  is(column: string, value: unknown): QueuedQuery {
    this.client.queryCalls.push({
      column,
      kind: "filter",
      tableName: this.tableName,
      value,
    })
    return this
  }

  in(column: string, value: unknown[]): QueuedQuery {
    this.client.queryCalls.push({
      column,
      kind: "filter",
      tableName: this.tableName,
      value,
    })
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
  readonly queryCalls: Array<
    | {
        kind: "insert" | "update"
        tableName: string
        values: Record<string, unknown>
      }
    | {
        column: string
        kind: "filter"
        tableName: string
        value: unknown
      }
  > = []
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

describe("organization context lookup", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns the mapped context from one rpc round trip", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const client = new QueuedAdminClient(
      {},
      {
        get_current_organization_context: [
          {
            data: [
              {
                membership_id: OWNER_MEMBERSHIP_ID,
                org_id: ORGANIZATION_ID,
                user_id: OWNER_ID,
                role: "owner_admin",
                status: "active",
                membership_created_at: "2026-07-01T00:00:00.000Z",
                membership_updated_at: "2026-07-01T00:00:00.000Z",
                organization_name: "Acme",
                organization_slug: "acme",
                organization_created_by: OWNER_ID,
                organization_created_at: "2026-06-01T00:00:00.000Z",
                organization_updated_at: "2026-06-01T00:00:00.000Z",
              },
            ],
            error: null,
          },
        ],
      }
    )

    const context = await getCurrentOrganizationContext(OWNER_ID, {
      client: client as never,
    })

    expect(context?.organization).toMatchObject({
      id: ORGANIZATION_ID,
      name: "Acme",
      slug: "acme",
    })
    expect(context?.membership).toMatchObject({
      id: OWNER_MEMBERSHIP_ID,
      organizationId: ORGANIZATION_ID,
      role: "owner_admin",
    })
    expect(client.rpcCalls).toEqual([
      {
        functionName: "get_current_organization_context",
        args: { target_user_id: OWNER_ID },
      },
    ])
    expect(client.fromCalls).toEqual([])
  })

  it("returns null when the user has no active membership", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const client = new QueuedAdminClient(
      {},
      { get_current_organization_context: [{ data: [], error: null }] }
    )

    const context = await getCurrentOrganizationContext(OWNER_ID, {
      client: client as never,
    })

    expect(context).toBeNull()
  })

  it("maps workspace names and editable role permissions from the context rpc", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const client = new QueuedAdminClient(
      {},
      {
        get_current_organization_context: [
          {
            data: [
              {
                membership_id: MEMBER_MEMBERSHIP_ID,
                org_id: ORGANIZATION_ID,
                user_id: MEMBER_ID,
                role: "staff",
                role_definition_id: CUSTOM_ROLE_ID,
                role_definition_name: "Billing assistant",
                role_definition_system_key: null,
                role_definition_permissions: ["people:view"],
                workspace_display_name: "Avery Kim",
                status: "active",
                membership_created_at: "2026-07-01T00:00:00.000Z",
                membership_updated_at: "2026-07-01T00:00:00.000Z",
                organization_name: "Acme",
                organization_slug: "acme",
                organization_created_by: OWNER_ID,
                organization_created_at: "2026-06-01T00:00:00.000Z",
                organization_updated_at: "2026-06-01T00:00:00.000Z",
              },
            ],
            error: null,
          },
        ],
      }
    )

    await expect(
      getCurrentOrganizationContext(MEMBER_ID, { client: client as never })
    ).resolves.toMatchObject({
      membership: {
        customPermissions: ["people:view"],
        roleDefinitionId: CUSTOM_ROLE_ID,
        roleName: "Billing assistant",
        workspaceDisplayName: "Avery Kim",
      },
    })
  })
})

describe("organization service atomic mutations", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const INVITER_ID = "20000000-0000-4000-8000-000000000003"
  const INVITER_MEMBERSHIP_ID = "30000000-0000-4000-8000-000000000003"
  const STAFF_ROLE_DEFINITION_ID = "50000000-0000-4000-8000-000000000007"
  const acceptInput = {
    userId: MEMBER_ID,
    userEmail: "MEMBER@example.com",
    token: INVITE_TOKEN,
  }

  it.each([
    ["the inviter is no longer an active member", null, INVITER_ID],
    ["the invite has no recorded inviter", null, null],
    [
      "the inviter's role no longer grants invitations",
      createRoleHolderRow(
        "manager",
        getOrganizationRolePermissions("manager").filter(
          (permission) => permission !== "members:invite"
        )
      ),
      INVITER_ID,
    ],
    [
      "the invited role now exceeds the inviter's access",
      createRoleHolderRow("staff", ["people:view", "members:invite"]),
      INVITER_ID,
    ],
  ])("rejects acceptance when %s", async (_case, inviterMembership, invitedBy) => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const client = createAcceptInviteClient(inviterMembership, invitedBy)

    await expect(
      acceptInvite(acceptInput, { client: client as never, recordAuditLog: vi.fn() })
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(client.rpcCalls).toEqual([])
  })

  it("accepts an invite through the transactional RPC and verifies membership", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const client = createAcceptInviteClient(
      createMembershipRow(OWNER_MEMBERSHIP_ID, OWNER_ID, "owner_admin"),
      OWNER_ID
    )
    const recordAuditLog = vi.fn(async (): Promise<void> => {})

    const context = await acceptInvite(acceptInput, {
      client: client as never,
      recordAuditLog,
    })

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

  function createRoleHolderRow(
    role: "manager" | "staff",
    permissions: readonly string[]
  ): Record<string, unknown> {
    const roleDefinitionId = role === "manager" ? MANAGER_ROLE_ID : CUSTOM_ROLE_ID

    return {
      ...createMembershipRow(INVITER_MEMBERSHIP_ID, INVITER_ID, role),
      role_definition_id: roleDefinitionId,
      role_definition: {
        id: roleDefinitionId,
        name: role === "manager" ? "Manager" : "Recruiter",
        system_key: role === "manager" ? "manager" : null,
        permissions,
      },
    }
  }

  // Queues the whole acceptance path, so a missing authority check shows up as
  // an executed acceptance RPC rather than as a missing-fixture error.
  function createAcceptInviteClient(
    inviterMembership: Record<string, unknown> | null,
    invitedBy: string | null
  ): QueuedAdminClient {
    return new QueuedAdminClient(
      {
        invites: [
          {
            data: createInviteRow({
              invited_by: invitedBy,
              role_definition_id: STAFF_ROLE_DEFINITION_ID,
            }),
            error: null,
          },
        ],
        organization_memberships: [
          { data: inviterMembership, error: null },
          {
            data: {
              ...createMembershipRow(MEMBER_MEMBERSHIP_ID, MEMBER_ID, "staff"),
              role_definition_id: STAFF_ROLE_DEFINITION_ID,
            },
            error: null,
          },
        ],
        organization_roles: [
          {
            data: createRoleRow({
              id: STAFF_ROLE_DEFINITION_ID,
              name: "Staff",
              permissions: getOrganizationRolePermissions("staff"),
              system_key: "staff",
            }),
            error: null,
          },
        ],
        organizations: [{ data: createOrganizationRow(), error: null }],
      },
      {
        accept_organization_invite: [
          { data: MEMBER_MEMBERSHIP_ID, error: null },
        ],
      }
    )
  }

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

  it("revokes an invite only after permission and tenant checks", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const revokedInvite = createInviteRow()
    revokedInvite.status = "revoked"
    const client = new QueuedAdminClient({
      organization_memberships: [
        {
          data: createMembershipRow(
            OWNER_MEMBERSHIP_ID,
            OWNER_ID,
            "owner_admin"
          ),
          error: null,
        },
      ],
      invites: [{ data: revokedInvite, error: null }],
    })
    const recordAuditLog = vi.fn(async (): Promise<void> => {})

    await expect(
      revokeInvite(
        {
          actorUserId: OWNER_ID,
          organizationId: ORGANIZATION_ID,
          inviteId: INVITE_ID,
        },
        { client: client as never, recordAuditLog }
      )
    ).resolves.toMatchObject({ id: INVITE_ID, status: "revoked" })
    expect(client.queryCalls).toEqual(
      expect.arrayContaining([
        {
          kind: "update",
          tableName: "invites",
          values: { status: "revoked" },
        },
        {
          column: "org_id",
          kind: "filter",
          tableName: "invites",
          value: ORGANIZATION_ID,
        },
        {
          column: "id",
          kind: "filter",
          tableName: "invites",
          value: INVITE_ID,
        },
        {
          column: "status",
          kind: "filter",
          tableName: "invites",
          value: ["pending", "expired"],
        },
      ])
    )
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "invite.revoked",
        organizationId: ORGANIZATION_ID,
        targetId: INVITE_ID,
      })
    )
  })

  it("rejects invite revocation for staff before reading the invite", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const client = new QueuedAdminClient({
      organization_memberships: [
        {
          data: createMembershipRow(
            MEMBER_MEMBERSHIP_ID,
            MEMBER_ID,
            "staff"
          ),
          error: null,
        },
      ],
    })

    await expect(
      revokeInvite(
        {
          actorUserId: MEMBER_ID,
          organizationId: ORGANIZATION_ID,
          inviteId: INVITE_ID,
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(client.fromCalls).not.toContain("invites")
  })

  it("denies the people directory when the owner revokes View people", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const member = createMembershipRow(MEMBER_MEMBERSHIP_ID, MEMBER_ID, "staff")
    member.role_definition = { permissions: [] }
    const client = new QueuedAdminClient({
      organization_memberships: [
        { data: member, error: null },
        { data: [member], error: null },
      ],
      profiles: [{ data: [{ id: MEMBER_ID, email: "member@example.com" }], error: null }],
      organization_roles: [{ data: [], error: null }],
    })

    await expect(
      listOrganizationPeople(MEMBER_ID, ORGANIZATION_ID, { client: client as never })
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(client.fromCalls).not.toContain("profiles")
    expect(client.fromCalls).not.toContain("organization_roles")
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
      organization_roles: [{ data: [], error: null }],
    })

    const people = await listOrganizationPeople(
      MEMBER_ID,
      ORGANIZATION_ID,
      { client: client as never }
    )

    expect(people.invites).toEqual([])
    expect(client.fromCalls).not.toContain("invites")
  })

  it("uses workspace display names and editable role labels in the people list", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const member = createMembershipRow(
      MEMBER_MEMBERSHIP_ID,
      MEMBER_ID,
      "staff"
    )
    member.workspace_display_name = "Avery Kim"
    member.role_definition_id = CUSTOM_ROLE_ID
    member.role_definition = {
      id: CUSTOM_ROLE_ID,
      name: "Billing assistant",
      system_key: null,
      permissions: ["people:view"],
    }
    const client = new QueuedAdminClient({
      organization_memberships: [
        {
          data: createMembershipRow(
            OWNER_MEMBERSHIP_ID,
            OWNER_ID,
            "owner_admin"
          ),
          error: null,
        },
        { data: [member], error: null },
      ],
      profiles: [
        {
          data: [
            {
              id: MEMBER_ID,
              email: "member@example.com",
              full_name: "Account name",
            },
          ],
          error: null,
        },
      ],
      invites: [{ data: [], error: null }],
      organization_roles: [{ data: [], error: null }],
    })

    await expect(
      listOrganizationPeople(OWNER_ID, ORGANIZATION_ID, {
        client: client as never,
      })
    ).resolves.toMatchObject({
      members: [
        {
          fullName: "Avery Kim",
          roleDefinitionId: CUSTOM_ROLE_ID,
          roleName: "Billing assistant",
          workspaceDisplayName: "Avery Kim",
        },
      ],
    })
  })
})

describe("member settings", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns the actor's own profile and notification toggles", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const client = new QueuedAdminClient({
      profiles: [
        {
          data: { full_name: "Ada Lovelace", phone_number: "+14155552671" },
          error: null,
        },
      ],
      organization_memberships: [
        {
          data: {
            email_notifications_enabled: false,
            sms_notifications_enabled: true,
          },
          error: null,
        },
      ],
    })

    await expect(
      getMemberSettings(
        { actorUserId: OWNER_ID, organizationId: ORGANIZATION_ID },
        { client: client as never }
      )
    ).resolves.toEqual({
      displayName: "Ada Lovelace",
      phoneNumber: "+14155552671",
      emailNotificationsEnabled: false,
      smsNotificationsEnabled: true,
    })
  })

  it("rejects when the actor has no active membership in the organization", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const client = new QueuedAdminClient({
      profiles: [{ data: { full_name: null, phone_number: null }, error: null }],
      organization_memberships: [{ data: null, error: null }],
    })

    await expect(
      getMemberSettings(
        { actorUserId: MEMBER_ID, organizationId: ORGANIZATION_ID },
        { client: client as never }
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it("defaults both notification toggles to enabled when the columns are null", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const client = new QueuedAdminClient({
      profiles: [{ data: null, error: null }],
      organization_memberships: [
        {
          data: {
            email_notifications_enabled: null,
            sms_notifications_enabled: null,
          },
          error: null,
        },
      ],
    })

    await expect(
      getMemberSettings(
        { actorUserId: OWNER_ID, organizationId: ORGANIZATION_ID },
        { client: client as never }
      )
    ).resolves.toMatchObject({
      displayName: null,
      emailNotificationsEnabled: true,
      smsNotificationsEnabled: true,
    })
  })
})

describe("organization role definitions and member access", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("creates a custom role with only supported permissions", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const client = new QueuedAdminClient({
      organization_memberships: [
        {
          data: createMembershipRow(
            OWNER_MEMBERSHIP_ID,
            OWNER_ID,
            "owner_admin"
          ),
          error: null,
        },
      ],
      organization_roles: [
        {
          data: createRoleRow({
            id: CUSTOM_ROLE_ID,
            name: "Billing assistant",
            permissions: ["people:view", "documents:view"],
            system_key: null,
          }),
          error: null,
        },
      ],
    })
    const recordAuditLog = vi.fn(async (): Promise<void> => {})

    await expect(
      createOrganizationRole(
        {
          actorUserId: OWNER_ID,
          organizationId: ORGANIZATION_ID,
          name: " Billing assistant ",
          permissions: ["people:view", "documents:view"],
        },
        { client: client as never, recordAuditLog }
      )
    ).resolves.toMatchObject({
      id: CUSTOM_ROLE_ID,
      name: "Billing assistant",
      permissions: ["people:view", "documents:view"],
      systemKey: null,
    })
    expect(client.queryCalls).toContainEqual({
      kind: "insert",
      tableName: "organization_roles",
      values: {
        org_id: ORGANIZATION_ID,
        name: "Billing assistant",
        permissions: ["people:view", "documents:view"],
        system_key: null,
      },
    })
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "organization_role.created",
        targetId: CUSTOM_ROLE_ID,
      })
    )
  })

  describe("invite role authority", () => {
    const STAFF_ROLE_ID = "50000000-0000-4000-8000-000000000004"
    const REVIEWER_ROLE_ID = "50000000-0000-4000-8000-000000000005"
    const RECRUITER_ROLE_ID = "50000000-0000-4000-8000-000000000006"
    const managerPermissions = getOrganizationRolePermissions("manager")
    const reviewerPermissions =
      getOrganizationRolePermissions("external_reviewer")
    const managerRole = createRoleRow({ permissions: managerPermissions })
    const reviewerRole = createRoleRow({
      id: REVIEWER_ROLE_ID,
      name: "External Reviewer",
      permissions: reviewerPermissions,
      system_key: "external_reviewer",
    })
    const manager = createInviterRow(
      "manager",
      MANAGER_ROLE_ID,
      managerPermissions
    )
    const narrowRecruiter = createInviterRow("staff", RECRUITER_ROLE_ID, [
      "people:view",
      "members:invite",
    ])

    it.each([
      ["a narrow custom inviter selects Manager", narrowRecruiter, managerRole],
      [
        "a narrow custom inviter grants a permission it lacks",
        narrowRecruiter,
        createRoleRow({
          id: CUSTOM_ROLE_ID,
          name: "Workspace admin",
          permissions: ["people:view", "organization:manage"],
          system_key: null,
        }),
      ],
      [
        "a Staff-scoped inviter holding every Manager permission selects Manager",
        createInviterRow("staff", RECRUITER_ROLE_ID, managerPermissions),
        managerRole,
      ],
      [
        "a Staff-scoped inviter selects External Reviewer row scope",
        createInviterRow("staff", RECRUITER_ROLE_ID, [
          "members:invite",
          ...reviewerPermissions,
        ]),
        reviewerRole,
      ],
      [
        "a Manager selects a Staff role widened beyond Manager access",
        manager,
        createRoleRow({
          id: STAFF_ROLE_ID,
          name: "Staff",
          permissions: ["people:view", "organization:manage"],
          system_key: "staff",
        }),
      ],
    ])("rejects an invite when %s", async (_case, actor, targetRole) => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const harness = createInviteHarness(actor, targetRole)

      await expect(
        createInvite(harness.input, harness.deps)
      ).rejects.toMatchObject({ statusCode: 403 })
      expect(harness.client.queryCalls).not.toContainEqual(
        expect.objectContaining({ kind: "insert", tableName: "invites" })
      )
      expect(harness.sendInviteEmail).not.toHaveBeenCalled()
      expect(harness.recordAuditLog).not.toHaveBeenCalled()
    })

    it.each([
      [
        "an Owner invites a custom role",
        createMembershipRow(OWNER_MEMBERSHIP_ID, OWNER_ID, "owner_admin"),
        createRoleRow({
          id: CUSTOM_ROLE_ID,
          name: "Billing assistant",
          permissions: ["people:view"],
          system_key: null,
        }),
        "staff",
      ],
      ["a Manager invites another Manager", manager, managerRole, "manager"],
      [
        "a Manager invites an External Reviewer",
        manager,
        reviewerRole,
        "external_reviewer",
      ],
      [
        "a custom inviter invites a role inside its own access",
        createInviterRow("staff", RECRUITER_ROLE_ID, [
          "people:view",
          "members:invite",
          "documents:view",
        ]),
        createRoleRow({
          id: CUSTOM_ROLE_ID,
          name: "Document viewer",
          permissions: ["people:view", "documents:view"],
          system_key: null,
        }),
        "staff",
      ],
    ])(
      "persists an invite when %s",
      async (_case, actor, targetRole, persistedRole) => {
        vi.spyOn(console, "info").mockImplementation(() => {})
        const harness = createInviteHarness(actor, targetRole)

        await expect(
          createInvite(harness.input, harness.deps)
        ).resolves.toMatchObject({
          invite: {
            roleDefinitionId: targetRole.id,
            roleName: targetRole.name,
          },
        })
        expect(harness.client.queryCalls).toContainEqual({
          kind: "insert",
          tableName: "invites",
          values: expect.objectContaining({
            invited_by: harness.input.actorUserId,
            role: persistedRole,
            role_definition_id: targetRole.id,
          }),
        })
        expect(harness.sendInviteEmail).toHaveBeenCalledOnce()
      }
    )

    function createInviterRow(
      role: "manager" | "staff",
      roleDefinitionId: string,
      permissions: readonly string[]
    ): Record<string, unknown> {
      return {
        ...createMembershipRow(MEMBER_MEMBERSHIP_ID, MEMBER_ID, role),
        role_definition_id: roleDefinitionId,
        role_definition: {
          id: roleDefinitionId,
          name: role === "manager" ? "Manager" : "Recruiter",
          system_key: role === "manager" ? "manager" : null,
          permissions,
        },
      }
    }

    // Queues the complete success path, so an unenforced rule shows up as a
    // persisted invite rather than as a missing-fixture error.
    function createInviteHarness(
      actorMembership: Record<string, unknown>,
      targetRole: Record<string, unknown>
    ) {
      const client = new QueuedAdminClient({
        organization_memberships: [{ data: actorMembership, error: null }],
        organization_roles: [{ data: targetRole, error: null }],
        organizations: [{ data: createOrganizationRow(), error: null }],
        profiles: [{ data: null, error: null }],
        invites: [
          { data: [], error: null },
          {
            data: createInviteRow({
              role: targetRole.system_key ?? "staff",
              role_definition_id: targetRole.id,
              role_definition: targetRole,
            }),
            error: null,
          },
        ],
      })
      const recordAuditLog = vi.fn(async (): Promise<void> => {})
      const sendInviteEmail = vi.fn(async (): Promise<void> => {})

      return {
        client,
        recordAuditLog,
        sendInviteEmail,
        deps: {
          client: client as never,
          createInviteToken: () => INVITE_TOKEN,
          now: () => new Date("2026-07-17T20:00:00.000Z"),
          recordAuditLog,
          sendInviteEmail,
        },
        input: {
          actorUserId: String(actorMembership.user_id),
          organizationId: ORGANIZATION_ID,
          email: "invitee@example.com",
          roleId: String(targetRole.id),
        },
      }
    }
  })

  it("allows a starter role name and permissions to change", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const client = new QueuedAdminClient({
      organization_memberships: [
        {
          data: createMembershipRow(
            OWNER_MEMBERSHIP_ID,
            OWNER_ID,
            "owner_admin"
          ),
          error: null,
        },
      ],
      organization_roles: [
        { data: createRoleRow(), error: null },
        {
          data: createRoleRow({
            name: "Operations lead",
            permissions: ["people:view", "members:invite"],
          }),
          error: null,
        },
      ],
    })

    await expect(
      updateOrganizationRole(
        {
          actorUserId: OWNER_ID,
          organizationId: ORGANIZATION_ID,
          roleId: MANAGER_ROLE_ID,
          name: "Operations lead",
          permissions: ["people:view", "members:invite"],
        },
        { client: client as never, recordAuditLog: vi.fn() }
      )
    ).resolves.toMatchObject({
      name: "Operations lead",
      permissions: ["people:view", "members:invite"],
      systemKey: "manager",
    })
    expect(client.queryCalls).toContainEqual({
      kind: "update",
      tableName: "organization_roles",
      values: {
        name: "Operations lead",
        permissions: ["people:view", "members:invite"],
      },
    })
  })

  it("rejects permission changes for the protected owner role", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const client = new QueuedAdminClient({
      organization_memberships: [
        {
          data: createMembershipRow(
            OWNER_MEMBERSHIP_ID,
            OWNER_ID,
            "owner_admin"
          ),
          error: null,
        },
      ],
      organization_roles: [
        {
          data: createRoleRow({
            id: "50000000-0000-4000-8000-000000000003",
            name: "Owner",
            system_key: "owner_admin",
          }),
          error: null,
        },
      ],
    })

    await expect(
      updateOrganizationRole(
        {
          actorUserId: OWNER_ID,
          organizationId: ORGANIZATION_ID,
          roleId: "50000000-0000-4000-8000-000000000003",
          name: "Workspace owner",
          permissions: [],
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(client.queryCalls).not.toContainEqual(
      expect.objectContaining({ kind: "update" })
    )
  })

  it("updates a workspace display name and role atomically", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const updatedMembership = createMembershipRow(
      MEMBER_MEMBERSHIP_ID,
      MEMBER_ID,
      "staff"
    )
    updatedMembership.workspace_display_name = "Avery Kim"
    updatedMembership.role_definition_id = CUSTOM_ROLE_ID
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
          { data: updatedMembership, error: null },
        ],
      },
      {
        update_organization_member_access: [
          { data: MEMBER_MEMBERSHIP_ID, error: null },
        ],
      }
    )
    const recordAuditLog = vi.fn(async (): Promise<void> => {})

    await expect(
      updateMemberAccess(
        {
          actorUserId: OWNER_ID,
          organizationId: ORGANIZATION_ID,
          membershipId: MEMBER_MEMBERSHIP_ID,
          roleId: CUSTOM_ROLE_ID,
          workspaceDisplayName: " Avery Kim ",
        },
        { client: client as never, recordAuditLog }
      )
    ).resolves.toMatchObject({
      id: MEMBER_MEMBERSHIP_ID,
      roleDefinitionId: CUSTOM_ROLE_ID,
      workspaceDisplayName: "Avery Kim",
    })
    expect(client.rpcCalls).toContainEqual({
      functionName: "update_organization_member_access",
      args: {
        target_actor_user_id: OWNER_ID,
        target_membership_id: MEMBER_MEMBERSHIP_ID,
        target_org_id: ORGANIZATION_ID,
        target_role_definition_id: CUSTOM_ROLE_ID,
        target_workspace_display_name: "Avery Kim",
      },
    })
  })

  it("archives any non-owner role through the locked database operation", async () => {
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
        ],
      },
      {
        archive_organization_role: [{ data: CUSTOM_ROLE_ID, error: null }],
      }
    )

    await expect(
      archiveOrganizationRole(
        {
          actorUserId: OWNER_ID,
          organizationId: ORGANIZATION_ID,
          roleId: CUSTOM_ROLE_ID,
        },
        { client: client as never, recordAuditLog: vi.fn() }
      )
    ).resolves.toBeUndefined()
    expect(client.rpcCalls).toContainEqual({
      functionName: "archive_organization_role",
      args: {
        target_actor_user_id: OWNER_ID,
        target_org_id: ORGANIZATION_ID,
        target_role_definition_id: CUSTOM_ROLE_ID,
      },
    })
  })

  it("reports a role with active assignments as a conflict", async () => {
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
        ],
      },
      {
        archive_organization_role: [
          {
            data: null,
            error: {
              code: "23503",
              message: "Role is still assigned to a member.",
            },
          },
        ],
      }
    )

    await expect(
      archiveOrganizationRole(
        {
          actorUserId: OWNER_ID,
          organizationId: ORGANIZATION_ID,
          roleId: CUSTOM_ROLE_ID,
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({ statusCode: 409 })
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

function createRoleRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: MANAGER_ROLE_ID,
    org_id: ORGANIZATION_ID,
    system_key: "manager",
    name: "Manager",
    permissions: null,
    archived_at: null,
    created_at: "2026-07-17T20:00:00.000Z",
    updated_at: "2026-07-17T20:00:00.000Z",
    ...overrides,
  }
}

function createInviteRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: INVITE_ID,
    org_id: ORGANIZATION_ID,
    email: "member@example.com",
    role: "staff",
    token: INVITE_TOKEN,
    status: "pending",
    expires_at: "2026-07-24T20:00:00.000Z",
    created_at: "2026-07-17T20:00:00.000Z",
    ...overrides,
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
