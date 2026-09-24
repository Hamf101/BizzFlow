import { describe, expect, it } from "vitest"

import { FakeSupabaseClient } from "@/services/document-service.test-support"
import { requirePermission } from "@/services/documents/shared"

describe("document role-definition permissions", () => {
  it("rechecks edited permissions instead of retaining the starter role grants", async () => {
    const roleDefinition = { permissions: ["documents:archive"] }
    const client = createClient("manager", roleDefinition)

    await expect(checkArchive(client)).resolves.toMatchObject({
      role: "manager",
    })

    roleDefinition.permissions = []

    await expect(checkArchive(client)).rejects.toMatchObject({ statusCode: 403 })
  })

  it("honors an explicitly granted permission absent from the starter role", async () => {
    const client = createClient("external_reviewer", {
      permissions: ["documents:archive"],
    })

    await expect(checkArchive(client)).resolves.toMatchObject({
      role: "external_reviewer",
      customPermissions: ["documents:archive"],
    })
  })

  it("rejects unsupported persisted permissions instead of restoring broad access", async () => {
    const client = createClient("manager", { permissions: ["unknown:permission"] })

    await expect(checkArchive(client)).rejects.toMatchObject({ statusCode: 500 })
  })

  it("keeps the protected owner role fully authorized", async () => {
    const client = createClient("owner_admin", { permissions: null })

    await expect(checkArchive(client)).resolves.toMatchObject({ role: "owner_admin" })
  })

  it("does not use a role grant from another organization", async () => {
    const client = createClient("manager", { permissions: ["documents:archive"] })
    client.tables.organization_memberships[0].org_id = "other-org"

    await expect(checkArchive(client)).rejects.toMatchObject({ statusCode: 403 })
  })
})

function createClient(
  role: string,
  roleDefinition: { permissions: string[] | null }
): FakeSupabaseClient {
  return new FakeSupabaseClient({
    organization_memberships: [{
      id: "membership-1",
      org_id: "org-1",
      user_id: "user-1",
      role,
      role_definition: roleDefinition,
      status: "active",
      created_at: "2026-09-08T12:00:00.000Z",
      updated_at: "2026-09-08T12:00:00.000Z",
    }],
  })
}

function checkArchive(client: FakeSupabaseClient): ReturnType<typeof requirePermission> {
  return requirePermission(client as never, "org-1", "user-1", "documents:archive", "Access denied.")
}
