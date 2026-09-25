import type { SupabaseClient } from "@supabase/supabase-js"

import { chooseOption } from "../support/choose"
import { expect, signInAs, test } from "../support/fixtures"

/**
 * Journey 2 — invite a member, accept the invite, prove the role is enforced.
 *
 * The role assertion is the point of this spec. Anyone can render a member row;
 * what matters is that a staff account cannot reach the controls that grant
 * access to other people. `members:invite` is held by owner_admin and manager
 * and withheld from staff (src/lib/permissions.ts), so the invite form is the
 * cleanest visible proof that the guard is wired to the real permission table.
 */
test.describe("invitations", () => {
  test("invites a member who can accept and join the workspace", async ({
    admin,
    browser,
    pageAs,
    tenant,
  }) => {
    const owner = await pageAs("owner_admin")
    const inviteeEmail = `invitee-${Date.now().toString(36)}@e2e.bizflow.test`
    const password = "e2e-BizFlow-Passw0rd"

    await owner.goto("/people")
    await owner.getByRole("button", { name: "Invite", exact: true }).click()
    const inviteForm = owner.locator("form").filter({
      has: owner.getByRole("button", { name: "Send invite" }),
    })

    await inviteForm.getByLabel("Email").fill(inviteeEmail)
    await chooseOption(inviteForm.getByLabel("Role"), "Staff")
    await inviteForm.getByRole("button", { name: "Send invite" }).click()

    await owner.getByRole("button", { name: "Invite", exact: true }).click()
    await owner.getByRole("tab", { name: /Manage invites/ }).click()
    await expect(owner.getByText(inviteeEmail)).toBeVisible()

    // The token is generated server-side and only ever emailed, so a test has to
    // read it from the row rather than scrape it from the page.
    const { data: invite } = await admin
      .from("invites")
      .select("token")
      .eq("email", inviteeEmail)
      .eq("org_id", tenant.organizationId)
      .single()

    expect(invite?.token).toBeTruthy()

    // A new person answers in one step: the invite proved their address.
    const context = await browser.newContext()
    const page = await context.newPage()
    const join = `Join ${tenant.organizationName}`

    try {
      await page.goto(`/accept-invite/${invite?.token as string}`)
      await page.getByLabel("Choose a password").fill(password)
      await page.getByRole("button", { name: join }).click()
      await page.waitForURL(/\/dashboard/)
      await expect(page.getByRole("status").filter({ hasText: "You joined the workspace" })).toBeVisible()

      const inviteeId = await joinedUserId(admin, inviteeEmail)
      const { data: membership, error: membershipError } = await admin
        .from("organization_memberships")
        .select("org_id,role,status")
        .eq("org_id", tenant.organizationId)
        .eq("user_id", inviteeId)
        .single()

      expect(membershipError).toBeNull()
      expect(membership).toMatchObject({
        org_id: tenant.organizationId,
        role: "staff",
        status: "active",
      })

      const dashboard = page.getByRole("main")

      await expect(dashboard.getByText(tenant.organizationName, { exact: true })).toBeVisible()
      await expect(dashboard.getByRole("region", { name: "Waiting on you" })).toBeVisible()
      // Setting the workspace up is the owner's job, not a new staff member's.
      await expect(dashboard.getByText("Getting started")).toBeHidden()
    } finally {
      await context.close()
      await admin.auth.admin.deleteUser(await joinedUserId(admin, inviteeEmail)).catch(() => {})
    }
  })

  test("someone logged in as another account switches, then joins with the account they already have", async ({
    admin,
    browser,
    tenant,
  }) => {
    const suffix = Date.now().toString(36)
    const inviteeEmail = `existing-${suffix}@e2e.bizflow.test`
    const otherEmail = `other-${suffix}@e2e.bizflow.test`
    const password = "e2e-BizFlow-Passw0rd"
    const token = `e2e-invite-${suffix}`

    const userIds: string[] = []

    for (const email of [inviteeEmail, otherEmail]) {
      const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password })
      expect(error).toBeNull()
      userIds.push(data.user?.id as string)
    }

    const { data: staffRole } = await admin
      .from("organization_roles")
      .select("id")
      .eq("org_id", tenant.organizationId)
      .eq("system_key", "staff")
      .single()
    const { error: inviteError } = await admin.from("invites").insert({
      email: inviteeEmail,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      invited_by: tenant.users.owner_admin.id,
      org_id: tenant.organizationId,
      role: "staff",
      role_definition_id: staffRole?.id,
      status: "pending",
      token,
    })
    expect(inviteError).toBeNull()

    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      await signInAs(page, otherEmail, password)
      await page.goto(`/accept-invite/${token}`)
      await page.getByRole("button", { name: "Log out and continue" }).click()
      await page.getByRole("link", { name: "Log in instead" }).click()
      await page.getByLabel("Password", { exact: true }).fill(password)
      await page.getByRole("button", { name: `Join ${tenant.organizationName}` }).click()
      await page.waitForURL(/\/dashboard/)
      await expect(page.getByRole("status").filter({ hasText: "You joined the workspace" })).toBeVisible()

      const { data: membership } = await admin
        .from("organization_memberships")
        .select("status")
        .eq("org_id", tenant.organizationId)
        .eq("user_id", userIds[0])
        .single()
      expect(membership?.status).toBe("active")
    } finally {
      await context.close()

      for (const id of userIds) {
        await admin.auth.admin.deleteUser(id)
      }
    }
  })

  test("hides member invitation from a staff account", async ({ pageAs }) => {
    const manager = await pageAs("manager")
    const staff = await pageAs("staff")

    await manager.goto("/people")
    await staff.goto("/people")

    // Both roles can see the page; only one can hand out access.
    await expect(
      manager.getByRole("heading", { name: "People" })
    ).toBeVisible()
    await expect(staff.getByRole("heading", { name: "People" })).toBeVisible()

    await expect(
      manager.getByRole("button", { name: "Invite", exact: true })
    ).toBeVisible()
    await expect(
      staff.getByRole("button", { name: "Invite", exact: true })
    ).toBeHidden()
  })
})

/** Accepting an invite records the member's profile, which is how a spec finds an account the app opened. */
async function joinedUserId(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("id").eq("email", email).single()
  if (error) throw error
  return data.id as string
}
