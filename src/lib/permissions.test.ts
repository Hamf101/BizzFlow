import { describe, expect, it } from "vitest"

import {
  canAssignOrganizationRole,
  canPerformOrganizationAction,
  canInviteMembers,
  canUpdateMemberRole,
  createOrganizationPermissionSubject,
  getAssignableOrganizationRoles,
  getOrganizationRolePermissions,
  ORGANIZATION_PERMISSION_ACTIONS,
} from "./permissions"

describe("organization role assignment authority", () => {
  const managerDefaults = getOrganizationRolePermissions("manager")
  const reviewerDefaults = getOrganizationRolePermissions("external_reviewer")

  it("never assigns Owner and lets an Owner assign every other role", () => {
    const ownerRole = { systemKey: "owner_admin", permissions: null } as const

    expect(canAssignOrganizationRole("owner_admin", ownerRole)).toBe(false)
    expect(canAssignOrganizationRole("manager", ownerRole)).toBe(false)
    expect(
      canAssignOrganizationRole("owner_admin", {
        systemKey: null,
        permissions: ORGANIZATION_PERMISSION_ACTIONS,
      })
    ).toBe(true)
  })

  it("keeps every starter role assignable by a default Manager", () => {
    for (const role of getAssignableOrganizationRoles()) {
      expect(
        canAssignOrganizationRole("manager", {
          systemKey: role,
          permissions: getOrganizationRolePermissions(role),
        })
      ).toBe(true)
    }
  })

  it("rejects any permission the actor does not currently hold", () => {
    const recruiter = {
      role: "staff",
      customPermissions: ["people:view", "members:invite", "documents:view"],
    } as const

    expect(
      canAssignOrganizationRole(recruiter, {
        systemKey: null,
        permissions: ["people:view", "documents:view"],
      })
    ).toBe(true)
    expect(
      canAssignOrganizationRole(recruiter, {
        systemKey: null,
        permissions: ["people:view", "organization:manage"],
      })
    ).toBe(false)
    expect(
      canAssignOrganizationRole("manager", {
        systemKey: "staff",
        permissions: ["people:view", "organization:manage"],
      })
    ).toBe(false)
  })

  it("rejects wider row scope even when every permission is held", () => {
    const staffScopedAdmin = {
      role: "staff",
      customPermissions: [...managerDefaults, ...reviewerDefaults],
    } as const

    expect(
      canAssignOrganizationRole(staffScopedAdmin, {
        systemKey: "manager",
        permissions: managerDefaults,
      })
    ).toBe(false)
    expect(
      canAssignOrganizationRole(staffScopedAdmin, {
        systemKey: "external_reviewer",
        permissions: reviewerDefaults,
      })
    ).toBe(false)
    expect(
      canAssignOrganizationRole(
        {
          role: "external_reviewer",
          customPermissions: [...reviewerDefaults, "members:invite"],
        },
        { systemKey: null, permissions: ["people:view"] }
      )
    ).toBe(false)
  })
})

describe("organization permissions", () => {
  it("parses persisted permissions and fails closed on unknown actions", () => {
    expect(
      createOrganizationPermissionSubject("staff", [
        "people:view",
        "members:invite",
      ])
    ).toEqual({
      role: "staff",
      customPermissions: ["people:view", "members:invite"],
    })
    expect(
      createOrganizationPermissionSubject("staff", ["unknown:action"])
    ).toBeNull()
  })

  it("allows only owner admins and managers to invite members", () => {
    expect(canInviteMembers("owner_admin")).toBe(true)
    expect(canInviteMembers("manager")).toBe(true)
    expect(canInviteMembers("staff")).toBe(false)
    expect(canInviteMembers("external_reviewer")).toBe(false)
  })

  it("allows only owner admins to update member roles", () => {
    expect(canUpdateMemberRole("owner_admin")).toBe(true)
    expect(canUpdateMemberRole("manager")).toBe(false)
    expect(canUpdateMemberRole("staff")).toBe(false)
    expect(canUpdateMemberRole("external_reviewer")).toBe(false)
  })

  it("does not allow assigning another owner admin through the people page", () => {
    expect(getAssignableOrganizationRoles()).toEqual([
      "manager",
      "staff",
      "external_reviewer",
    ])
  })

  it("blocks staff from manager and owner actions", () => {
    expect(canPerformOrganizationAction("staff", "people:view")).toBe(true)
    expect(canPerformOrganizationAction("staff", "members:invite")).toBe(false)
    expect(canPerformOrganizationAction("staff", "members:update_role")).toBe(false)
    expect(canPerformOrganizationAction("staff", "audit_logs:view")).toBe(false)
    expect(canPerformOrganizationAction("staff", "documents:view")).toBe(true)
    expect(canPerformOrganizationAction("staff", "document_comments:create")).toBe(true)
    expect(canPerformOrganizationAction("staff", "documents:create")).toBe(true)
    expect(canPerformOrganizationAction("staff", "documents:archive")).toBe(false)
    expect(canPerformOrganizationAction("staff", "folders:manage")).toBe(false)
    expect(canPerformOrganizationAction("staff", "document_versions:create")).toBe(true)
    expect(canPerformOrganizationAction("staff", "submissions:view")).toBe(true)
    expect(canPerformOrganizationAction("staff", "submissions:create")).toBe(true)
    expect(canPerformOrganizationAction("staff", "submissions:edit")).toBe(true)
    expect(canPerformOrganizationAction("staff", "submissions:assign")).toBe(false)
    expect(canPerformOrganizationAction("staff", "submissions:review")).toBe(false)
    expect(canPerformOrganizationAction("staff", "submission_comments:create")).toBe(
      true
    )
  })

  it("allows managers to invite members and view audit logs without role updates", () => {
    expect(canPerformOrganizationAction("manager", "people:view")).toBe(true)
    expect(canPerformOrganizationAction("manager", "members:invite")).toBe(true)
    expect(canPerformOrganizationAction("manager", "members:update_role")).toBe(false)
    expect(canPerformOrganizationAction("manager", "audit_logs:view")).toBe(true)
    expect(canPerformOrganizationAction("manager", "audit_logs:verify")).toBe(false)
    expect(canPerformOrganizationAction("owner_admin", "audit_logs:verify")).toBe(true)
    expect(canPerformOrganizationAction("manager", "documents:view")).toBe(true)
    expect(canPerformOrganizationAction("manager", "document_comments:create")).toBe(true)
    expect(canPerformOrganizationAction("manager", "documents:create")).toBe(true)
    expect(canPerformOrganizationAction("manager", "documents:archive")).toBe(true)
    expect(canPerformOrganizationAction("manager", "folders:manage")).toBe(true)
    expect(canPerformOrganizationAction("manager", "document_versions:create")).toBe(true)
    expect(canPerformOrganizationAction("manager", "submissions:view")).toBe(true)
    expect(canPerformOrganizationAction("manager", "submissions:create")).toBe(true)
    expect(canPerformOrganizationAction("manager", "submissions:edit")).toBe(true)
    expect(canPerformOrganizationAction("manager", "submissions:assign")).toBe(true)
    expect(canPerformOrganizationAction("manager", "submissions:review")).toBe(true)
    expect(canPerformOrganizationAction("manager", "submission_comments:create")).toBe(
      true
    )
  })

  it("applies template, send, and fill permissions by organization role", () => {
    expect(canPerformOrganizationAction("owner_admin", "templates:manage")).toBe(true)
    expect(canPerformOrganizationAction("manager", "templates:manage")).toBe(true)
    expect(canPerformOrganizationAction("staff", "templates:manage")).toBe(false)
    expect(canPerformOrganizationAction("external_reviewer", "templates:view")).toBe(false)

    expect(canPerformOrganizationAction("staff", "templates:view")).toBe(true)
    expect(canPerformOrganizationAction("staff", "documents:send")).toBe(true)
    expect(canPerformOrganizationAction("staff", "documents:fill")).toBe(true)
    expect(canPerformOrganizationAction("external_reviewer", "documents:send")).toBe(false)
    expect(canPerformOrganizationAction("external_reviewer", "documents:fill")).toBe(false)
  })

  it("allows external reviewers to view and comment on assigned submissions", () => {
    expect(canPerformOrganizationAction("external_reviewer", "people:view")).toBe(true)
    expect(canPerformOrganizationAction("external_reviewer", "documents:view")).toBe(true)
    expect(canPerformOrganizationAction("external_reviewer", "document_comments:create")).toBe(
      true
    )
    expect(canPerformOrganizationAction("external_reviewer", "documents:create")).toBe(false)
    expect(canPerformOrganizationAction("external_reviewer", "documents:archive")).toBe(false)
    expect(canPerformOrganizationAction("external_reviewer", "folders:manage")).toBe(false)
    expect(canPerformOrganizationAction("external_reviewer", "document_versions:create")).toBe(
      false
    )
    expect(canPerformOrganizationAction("external_reviewer", "members:invite")).toBe(false)
    expect(canPerformOrganizationAction("external_reviewer", "members:update_role")).toBe(false)
    expect(canPerformOrganizationAction("external_reviewer", "audit_logs:view")).toBe(false)
    expect(canPerformOrganizationAction("external_reviewer", "submissions:view")).toBe(true)
    expect(canPerformOrganizationAction("external_reviewer", "submissions:create")).toBe(false)
    expect(canPerformOrganizationAction("external_reviewer", "submissions:edit")).toBe(false)
    expect(canPerformOrganizationAction("external_reviewer", "submissions:assign")).toBe(false)
    expect(canPerformOrganizationAction("external_reviewer", "submissions:review")).toBe(false)
    expect(
      canPerformOrganizationAction("external_reviewer", "submission_comments:create")
    ).toBe(true)
  })

  it("grants task actions to internal roles only, with assignment held to managers", () => {
    expect(canPerformOrganizationAction("owner_admin", "tasks:view")).toBe(true)
    expect(canPerformOrganizationAction("owner_admin", "tasks:create")).toBe(true)
    expect(canPerformOrganizationAction("owner_admin", "tasks:edit")).toBe(true)
    expect(canPerformOrganizationAction("owner_admin", "tasks:assign")).toBe(true)

    expect(canPerformOrganizationAction("manager", "tasks:view")).toBe(true)
    expect(canPerformOrganizationAction("manager", "tasks:create")).toBe(true)
    expect(canPerformOrganizationAction("manager", "tasks:edit")).toBe(true)
    expect(canPerformOrganizationAction("manager", "tasks:assign")).toBe(true)

    expect(canPerformOrganizationAction("staff", "tasks:view")).toBe(true)
    expect(canPerformOrganizationAction("staff", "tasks:create")).toBe(true)
    expect(canPerformOrganizationAction("staff", "tasks:edit")).toBe(true)
    expect(canPerformOrganizationAction("staff", "tasks:assign")).toBe(false)

    expect(canPerformOrganizationAction("external_reviewer", "tasks:view")).toBe(false)
    expect(canPerformOrganizationAction("external_reviewer", "tasks:create")).toBe(false)
    expect(canPerformOrganizationAction("external_reviewer", "tasks:edit")).toBe(false)
    expect(canPerformOrganizationAction("external_reviewer", "tasks:assign")).toBe(false)
  })

  it("allows owner admins to perform every organization permission action", () => {
    expect(getOrganizationRolePermissions("owner_admin")).toEqual(
      ORGANIZATION_PERMISSION_ACTIONS
    )
  })

  it("uses an explicit custom permission set instead of the base staff grants", () => {
    const customAccess = {
      role: "staff" as const,
      customPermissions: ["people:view", "audit_logs:view"] as const,
    }

    expect(
      canPerformOrganizationAction(customAccess, "audit_logs:view")
    ).toBe(true)
    expect(
      canPerformOrganizationAction(customAccess, "documents:view")
    ).toBe(false)
  })

  it("keeps owner access complete even when persisted role data is malformed", () => {
    const ownerAccess = {
      role: "owner_admin" as const,
      customPermissions: [] as const,
    }

    for (const action of ORGANIZATION_PERMISSION_ACTIONS) {
      expect(canPerformOrganizationAction(ownerAccess, action)).toBe(true)
    }
  })

  it("keeps default role permissions fixed when no custom set exists", () => {
    expect(
      canPerformOrganizationAction(
        { role: "manager", customPermissions: null },
        "templates:manage"
      )
    ).toBe(true)
    expect(
      canPerformOrganizationAction(
        { role: "staff", customPermissions: null },
        "templates:manage"
      )
    ).toBe(false)
  })
})
