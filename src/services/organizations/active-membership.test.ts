import { afterEach, describe, expect, it, vi } from "vitest"

import { requirePermission as requireDocumentPermission } from "@/services/documents/shared"
import { PostgrestReadQuery } from "@/services/postgrest-fake.test-support"
import { requireTaskPermission } from "@/services/tasks/shared"
import { requirePermission as requireTemplatePermission } from "@/services/templates/shared"

const ORG_ID = "10000000-0000-4000-8000-000000000001"
const USER_ID = "20000000-0000-4000-8000-000000000001"
const MEMBERSHIP_ID = "30000000-0000-4000-8000-000000000001"

// A role a later migration added, or one hand-edited into the table.
const client = {
  from: () =>
    new PostgrestReadQuery([
      {
        id: MEMBERSHIP_ID,
        org_id: ORG_ID,
        user_id: USER_ID,
        role: "auditor",
        status: "active",
        role_definition: { permissions: ["documents:view", "templates:view", "tasks:view"] },
      },
    ]),
} as never

afterEach(() => {
  vi.restoreAllMocks()
})

describe("a membership whose stored role this build does not know", () => {
  it.each([
    ["documents", () => requireDocumentPermission(client, ORG_ID, USER_ID, "documents:view", "No.")],
    ["templates", () => requireTemplatePermission(client, ORG_ID, USER_ID, "templates:view", "No.")],
    ["tasks", () => requireTaskPermission(client, ORG_ID, USER_ID, "tasks:view", "No.")],
  ])("is refused by %s with a 403 and a warning that names only ids", async (_domain, check) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(check()).rejects.toMatchObject({ statusCode: 403 })
    expect(warn).toHaveBeenCalledWith("organization_membership_unknown_role", {
      organizationId: ORG_ID,
      userId: USER_ID,
      membershipId: MEMBERSHIP_ID,
    })
  })
})
