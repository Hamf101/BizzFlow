import type { SupabaseClient } from "@supabase/supabase-js"

import { expect, test, uniqueName } from "../support/fixtures"

/**
 * Journey 1 — sign up, create an organization, land on the dashboard.
 *
 * This is the only spec that does not use the seeded tenant: the thing under
 * test is account creation itself, so it has to start from nothing. It cleans up
 * after itself because a leaked auth user would collide on the unique email
 * index the next time the suite ran with the same label.
 *
 * It relies on `enable_confirmations = false` in `supabase/config.toml`. With
 * confirmations on, `signUp` returns no session and the app correctly sends the
 * user to /login to wait for an email — which is right in production and
 * untestable here.
 */
test.describe("onboarding", () => {
  // Signing up must happen in a clean browser, not one carrying seeded state.
  test.use({ storageState: { cookies: [], origins: [] } })

  test("creates an account, an organization, and reaches the dashboard", async ({
    admin,
    page,
  }) => {
    const email = `owner-${Date.now().toString(36)}@e2e.bizflow.test`
    const password = "e2e-BizFlow-Passw0rd"
    const organizationName = uniqueName("Acme")

    await page.goto("/signup")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(password)
    await page.getByRole("button", { name: "Sign up" }).click()

    // A session is returned inline when confirmations are disabled, so the app
    // goes straight on to naming the workspace rather than via /login.
    await page.waitForURL(/\/welcome/)

    await expect(
      page.getByRole("button", { name: "Create workspace" })
    ).toBeVisible()

    await page.getByLabel("Workspace name").fill(organizationName)
    await page.getByRole("button", { name: "Create workspace" }).click()

    await expect(
      page.getByRole("status").filter({ hasText: "Workspace created" })
    ).toBeVisible()
    await expect(page.getByRole("main").getByText(organizationName, { exact: true })).toBeVisible()
    await expect(page.getByRole("region", { name: "Waiting on you" })).toBeVisible()

    // The creator is the owner; every permission the app grants keys off this.
    const organization = await admin
      .from("organizations")
      .select("id")
      .eq("name", organizationName)
      .single()
    if (organization.error) throw organization.error
    const membership = await admin
      .from("organization_memberships")
      .select("role")
      .eq("org_id", organization.data.id)
      .single()
    if (membership.error) throw membership.error
    expect(membership.data.role).toBe("owner_admin")

    await cleanUp(admin, email, organizationName)
  })

  test("confirms a new address from the emailed link in any browser, once, then goes on to naming the workspace", async ({
    admin,
    browser,
  }) => {
    const email = `confirm-${Date.now().toString(36)}@e2e.bizflow.test`
    // Where a project asks for confirmation, this is the link the email carries.
    const { data, error } = await admin.auth.admin.generateLink({ email, password: "e2e-BizFlow-Passw0rd", type: "signup" })
    if (error) throw error
    const link = `/confirm-email?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=${data.properties.verification_type}`

    try {
      // Opened on another device: a browser that never saw the sign-up.
      const elsewhere = await browser.newContext()
      const page = await elsewhere.newPage()
      await page.goto(link)
      await page.getByRole("button", { name: "Confirm my email" }).click()
      await page.waitForURL(/\/welcome/)
      await expect(page.getByRole("button", { name: "Create workspace" })).toBeVisible()
      await elsewhere.close()

      const again = await (await browser.newContext()).newPage()
      await again.goto(link)
      await again.getByRole("button", { name: "Confirm my email" }).click()
      await expect(again.getByRole("heading", { name: "This link no longer works" })).toBeVisible()
      await again.context().close()
    } finally {
      await admin.auth.admin.deleteUser(data.user.id)
    }
  })

  test("refuses a password below the minimum length", async ({ page }) => {
    const email = `short-${Date.now().toString(36)}@e2e.bizflow.test`

    await page.goto("/signup")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill("short")
    await page.getByRole("button", { name: "Sign up" }).click()

    // The input carries minLength, so the browser blocks submission and the
    // user never leaves /signup. Asserting the URL rather than an error banner
    // keeps this true whether the guard is client- or server-side.
    await expect(page).toHaveURL(/\/signup/)
  })
})

/**
 * Removes the organization and auth user created by a test.
 *
 * @param admin - Service-role client.
 * @param email - Address of the account to delete.
 * @param organizationName - Organization to delete.
 * @returns Resolves once both are gone.
 */
async function cleanUp(
  admin: SupabaseClient,
  email: string,
  organizationName: string
): Promise<void> {
  await admin.from("organizations").delete().eq("name", organizationName)

  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle()

  if (data?.id) {
    await admin.auth.admin.deleteUser(data.id as string)
  }
}
