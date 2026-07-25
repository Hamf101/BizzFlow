import { describe, expect, it } from "vitest"

import {
  canPerformOrganizationAction,
  canInviteMembers,
  canUpdateMemberRole,
  getAssignableOrganizationRoles,
  getOrganizationRolePermissions,
  isOrganizationRole,
  ORGANIZATION_PERMISSION_ACTIONS,
  ORGANIZATION_ROLES,
} from "./permissions"

describe("organization permissions", () => {
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

  it("recognizes the supported organization roles", () => {
    expect(ORGANIZATION_ROLES).toEqual([
      "owner_admin",
      "manager",
      "staff",
      "external_reviewer",
    ])
    expect(isOrganizationRole("manager")).toBe(true)
    expect(isOrganizationRole("unknown")).toBe(false)
  })

  it("defines the supported organization permission actions", () => {
    expect(ORGANIZATION_PERMISSION_ACTIONS).toEqual([
      "people:view",
      "members:invite",
      "members:update_role",
      "audit_logs:view",
      "audit_logs:verify",
      "templates:view",
      "templates:manage",
      "documents:view",
      "documents:send",
      "documents:fill",
      "document_comments:create",
      "documents:create",
      "documents:archive",
      "folders:manage",
      "document_versions:create",
      "submissions:view",
      "submissions:create",
      "submissions:edit",
      "submissions:assign",
      "submissions:review",
      "submission_comments:create",
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
    expect(canPerformOrganizationAction("external_reviewer", "documents:fill")).toBe(true)
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

  it("allows owner admins to perform every organization permission action", () => {
    expect(getOrganizationRolePermissions("owner_admin")).toEqual(
      ORGANIZATION_PERMISSION_ACTIONS
    )
  })
})
