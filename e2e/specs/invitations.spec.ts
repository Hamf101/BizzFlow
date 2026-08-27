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
    const inviteForm = owner.locator("form").filter({
      has: owner.getByRole("button", { name: "Send invite" }),
    })

    await inviteForm.getByLabel("Email").fill(inviteeEmail)
    await inviteForm.getByLabel("Role").selectOption("staff")
    await inviteForm.getByRole("button", { name: "Send invite" }).click()

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

    // The invite flow supports an existing account signing in to accept; the
    // account is created directly so the spec tests acceptance, not signup.
    const { data: created, error: createUserError } =
      await admin.auth.admin.createUser({
        email: inviteeEmail,
        email_confirm: true,
        password,
      })

    expect(createUserError).toBeNull()
    expect(created.user).toBeTruthy()

    if (!created.user) {
      throw new Error("Supabase did not return the created invitee user.")
    }

    const createdUser = created.user

    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      await signInAs(page, inviteeEmail, password)
      await page.goto(`/accept-invite/${invite?.token as string}`)
      await page.getByRole("button", { name: "Accept invite" }).click()
      await page.waitForURL(/\/dashboard\?message=Invite\+accepted\./)

      const { data: membership, error: membershipError } = await admin
        .from("organization_memberships")
        .select("org_id,role,status")
        .eq("org_id", tenant.organizationId)
        .eq("user_id", createdUser.id)
        .single()

      expect(membershipError).toBeNull()
      expect(membership).toMatchObject({
        org_id: tenant.organizationId,
        role: "staff",
        status: "active",
      })

      const dashboard = page.getByRole("main")

      await expect(
        dashboard.getByText(tenant.organizationName, { exact: true })
      ).toBeVisible()
      await expect(dashboard.getByText("staff", { exact: true })).toBeVisible()
    } finally {
      await context.close()

      await admin.auth.admin.deleteUser(createdUser.id)
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
      manager.getByRole("button", { name: "Send invite" })
    ).toBeVisible()
    await expect(
      staff.getByRole("button", { name: "Send invite" })
    ).toBeHidden()
  })
})
