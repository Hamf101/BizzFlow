import { describe, expect, it } from "vitest"

import { FakeSupabaseClient, type FakeRow } from "@/services/document-service.test-support"
import { updateNotificationPreferences } from "@/services/organizations/membership-service"

const input = {
  actorUserId: "user-1",
  organizationId: "org-1",
  emailNotificationsEnabled: false,
  smsNotificationsEnabled: false,
}

describe("member notification preferences", () => {
  it("updates only the actor's active membership in the requested organization", async () => {
    const rows = [
      membership(),
      membership({ id: "other-tenant", org_id: "org-2" }),
      membership({ id: "other-user", user_id: "user-2" }),
    ]
    const client = new FakeSupabaseClient({ organization_memberships: rows })

    await expect(
      updateNotificationPreferences(input, {
        client: client as never,
        now: () => new Date("2026-09-09T18:00:00.000Z"),
      })
    )
      .resolves.toBeUndefined()

    expect(rows.map((row) => [row.email_notifications_enabled, row.sms_notifications_enabled]))
      .toEqual([[false, false], [true, true], [true, true]])
    expect(rows[0].updated_at).toBe("2026-07-09T12:00:00.000Z")
  })

  it.each([
    ["inactive membership", { status: "inactive" }],
    ["another organization", { org_id: "org-2" }],
    ["another actor", { user_id: "user-2" }],
  ])("rejects %s without changing stored preferences", async (_name, overrides) => {
    const row = membership(overrides)
    const before = { ...row }
    const client = new FakeSupabaseClient({ organization_memberships: [row] })

    await expect(updateNotificationPreferences(input, { client: client as never }))
      .rejects.toMatchObject({ statusCode: 403 })
    expect(row).toEqual(before)
  })

  it("rejects a missing membership instead of reporting a successful save", async () => {
    const client = new FakeSupabaseClient()

    await expect(updateNotificationPreferences(input, { client: client as never }))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})

function membership(overrides: FakeRow = {}): FakeRow {
  return {
    id: "membership-1",
    org_id: "org-1",
    user_id: "user-1",
    status: "active",
    email_notifications_enabled: true,
    sms_notifications_enabled: true,
    ...overrides,
  }
}
