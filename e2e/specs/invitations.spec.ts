import { createHash, randomBytes } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { chooseOption } from "../support/choose"
import { expect, signInAs, test, uniqueEmail, uniqueName } from "../support/fixtures"
import type { SeededTenant } from "../support/tenant"

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
    const inviteeEmail = uniqueEmail("invitee")
    const password = "e2e-BizFlow-Passw0rd"

    await owner.goto("/people")
    await owner.getByRole("button", { name: "Invite", exact: true }).click()
    const inviteForm = owner.locator("form").filter({
      has: owner.getByRole("button", { name: "Send invite" }),
    })

    await inviteForm.getByLabel("Email").fill(inviteeEmail)
    await chooseOption(inviteForm.getByLabel("Role"), "Staff")
    await inviteForm.getByRole("button", { name: "Send invite" }).click()

    // The e2e server reaches no email provider, and the email holds the only
    // copy of the link, so the invite is withdrawn and the owner told so.
    await expect(owner.getByText("Couldn't send the invite email")).toBeVisible()
    const { count } = await admin
      .from("invites")
      .select("id", { count: "exact", head: true })
      .eq("email", inviteeEmail)
      .eq("org_id", tenant.organizationId)
      .eq("status", "pending")
    expect(count).toBe(0)

    // The invite the email would have carried, seeded with a token chosen here
    // and stored only as its hash, as the app stores it.
    const token = randomBytes(24).toString("hex")
    await seedInvite(admin, tenant, inviteeEmail, token)

    // A new person answers in one step: the invite proved their address.
    const context = await browser.newContext()
    const page = await context.newPage()
    const join = `Join ${tenant.organizationName}`

    try {
      await page.goto(`/accept-invite/${token}`)
      await page.getByLabel("Your name").fill("Sam Okafor")
      await page.getByLabel("Choose a password").fill(password)
      await page.getByLabel("Confirm password").fill(password)
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

      // Who they said they are is theirs from the first page on.
      const { data: profile } = await admin
        .from("profiles")
        .select("full_name,phone_number")
        .eq("id", inviteeId)
        .single()
      expect(profile).toEqual({ full_name: "Sam Okafor", phone_number: null })

      const dashboard = page.getByRole("main")

      await expect(dashboard.getByRole("heading", { level: 1, name: "Welcome back, Sam" })).toBeVisible()
      // The workspace's name sits in the account menu on every screen size.
      await page.getByRole("button", { name: /^Open account menu/ }).click()
      await expect(page.getByRole("menu").getByText(tenant.organizationName)).toBeVisible()
      await page.keyboard.press("Escape")
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
    const inviteeEmail = uniqueEmail("existing")
    const otherEmail = uniqueEmail("other")
    const password = "e2e-BizFlow-Passw0rd"
    const token = uniqueName("e2e-invite").replace(" ", "-")

    const userIds: string[] = []
    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      for (const email of [inviteeEmail, otherEmail]) {
        const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password })
        expect(error).toBeNull()
        userIds.push(data.user?.id as string)
      }

      await seedInvite(admin, tenant, inviteeEmail, token)

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

/** A pending staff invite from the owner, kept as the app keeps it: only the token's hash. */
async function seedInvite(admin: SupabaseClient, tenant: SeededTenant, email: string, token: string): Promise<void> {
  const { data: staffRole } = await admin
    .from("organization_roles")
    .select("id")
    .eq("org_id", tenant.organizationId)
    .eq("system_key", "staff")
    .single()
  const { error } = await admin.from("invites").insert({
    email,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    invited_by: tenant.users.owner_admin.id,
    org_id: tenant.organizationId,
    role: "staff",
    role_definition_id: staffRole?.id,
    status: "pending",
    token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
  })
  expect(error).toBeNull()
}

/** Accepting an invite records the member's profile, which is how a spec finds an account the app opened. */
async function joinedUserId(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("id").eq("email", email).single()
  if (error) throw error
  return data.id as string
}
