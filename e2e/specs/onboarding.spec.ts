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
    await page.getByLabel("Password").fill(password)
    await page.getByRole("button", { name: "Create account" }).click()

    // A session is returned inline when confirmations are disabled, so the app
    // redirects straight to the dashboard rather than via /login.
    await page.waitForURL(/\/dashboard/)

    await expect(
      page.getByRole("button", { name: "Create organization" })
    ).toBeVisible()

    await page.getByLabel("Organization name").fill(organizationName)
    await page.getByRole("button", { name: "Create organization" }).click()

    await expect(page.getByText("Organization created.")).toBeVisible()
    await expect(page.getByText(organizationName)).toBeVisible()
    // The creator is the owner; every permission the app grants keys off this.
    await expect(page.getByText("owner_admin")).toBeVisible()

    await cleanUp(admin, email, organizationName)
  })

  test("refuses a password below the minimum length", async ({ page }) => {
    const email = `short-${Date.now().toString(36)}@e2e.bizflow.test`

    await page.goto("/signup")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password").fill("short")
    await page.getByRole("button", { name: "Create account" }).click()

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
