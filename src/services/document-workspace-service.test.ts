import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createFolder,
  listDocumentWorkspace,
} from "@/services/document-service"
import {
  createDeps,
  createMembershipRow,
  FakeSupabaseClient,
} from "@/services/document-service.test-support"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe("document service setup failures", () => {
  it("reports missing server credentials with a setup-specific error", async () => {
    process.env = {
      ...originalEnv,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    }

    await expect(
      listDocumentWorkspace({
        actorUserId: "user-1",
        organizationId: "org-1",
      })
    ).rejects.toMatchObject({
      message: "Supabase server credentials are not configured.",
      statusCode: 500,
    })
  })
})

describe("document service permissions", () => {
  it("rejects folder creation when the actor cannot manage folders", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("external_reviewer")],
    })
    const deps = createDeps(client, ["folder-1"])

    await expect(
      createFolder(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          name: "Client files",
        },
        deps
      )
    ).rejects.toMatchObject({
      message: "You cannot manage folders.",
      statusCode: 403,
    })

    expect(client.tables.folders).toHaveLength(0)
  })
})
