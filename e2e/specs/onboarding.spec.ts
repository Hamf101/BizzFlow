import type { SupabaseClient } from "@supabase/supabase-js"

import { expect, test, uniqueEmail, uniqueName } from "../support/fixtures"

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
    const email = uniqueEmail("owner")
    const password = "e2e-BizFlow-Passw0rd"
    const organizationName = uniqueName("Acme")

    try {
      await page.goto("/signup")
      await page.getByLabel("Email").fill(email)
      await page.getByLabel("Password", { exact: true }).fill(password)
      await page.getByLabel("Confirm password").fill(password)
      await page.getByRole("button", { name: "Sign up" }).click()

      // A session is returned inline when confirmations are disabled, so the app
      // goes straight on to naming the workspace rather than via /login.
      await page.waitForURL(/\/welcome/)

      await expect(
        page.getByRole("button", { name: "Create workspace" })
      ).toBeVisible()

      // Who they are goes in with the workspace, the phone written as people write it.
      await page.getByLabel("Your name").fill("Talora Reyes")
      await page.getByLabel("Phone").fill("+44 20 7946 0958")
      await page.getByLabel("Workspace name").fill(organizationName)
      await page.getByRole("button", { name: "Create workspace" }).click()

      await expect(
        page.getByRole("status").filter({ hasText: "Workspace created" })
      ).toBeVisible()
      await expect(page.getByRole("heading", { level: 1, name: "Welcome back, Talora" })).toBeVisible()
      // The workspace's name sits in the account menu on every screen size.
      await page.getByRole("button", { name: /^Open account menu/ }).click()
      await expect(page.getByRole("menu").getByText(organizationName)).toBeVisible()
      await page.keyboard.press("Escape")
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
        .select("role,user_id")
        .eq("org_id", organization.data.id)
        .single()
      if (membership.error) throw membership.error
      expect(membership.data.role).toBe("owner_admin")

      const profile = await admin
        .from("profiles")
        .select("full_name,phone_number")
        .eq("id", membership.data.user_id)
        .single()
      if (profile.error) throw profile.error
      expect(profile.data).toEqual({ full_name: "Talora Reyes", phone_number: "+442079460958" })
    } finally {
      await cleanUp(admin, email, organizationName)
    }
  })

  test("confirms a new address from the emailed link in any browser, once, then goes on to naming the workspace", async ({
    admin,
    browser,
  }) => {
    const email = uniqueEmail("confirm")
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

  test("refuses a weak password, and two passwords that don't match", async ({ page }) => {
    await page.goto("/signup")
    await page.getByLabel("Email").fill(uniqueEmail("weak"))
    await page.getByLabel("Password", { exact: true }).fill("longbutweak")
    await page.getByLabel("Confirm password").fill("longbutweak")
    await page.getByRole("button", { name: "Sign up" }).click()

    // The form holds until the password meets every rule. Asserting the URL
    // rather than a message keeps this true whether the browser or the
    // server stops it.
    await expect(page).toHaveURL(/\/signup/)
    await expect(page.getByRole("heading", { name: "Sign up for BizFlow" })).toBeVisible()

    await page.getByLabel("Password", { exact: true }).fill("e2e-BizFlow-Passw0rd")
    await page.getByLabel("Confirm password").fill("e2e-BizFlow-Passw0rd?")
    await expect(page.getByText("The passwords don't match.")).toBeVisible()
    await page.getByRole("button", { name: "Sign up" }).click()
    await expect(page).toHaveURL(/\/signup/)
    await expect(page.getByRole("heading", { name: "Sign up for BizFlow" })).toBeVisible()
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

test("home has one heading, the greeting, and offers a new document only to those who can make one", async ({ pageAs }) => {
  for (const role of ["owner_admin", "staff"] as const) {
    const page = await pageAs(role)
    await page.goto("/dashboard")

    await expect(page.getByRole("heading", { level: 1, name: /^Welcome back/ })).toBeVisible()
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)
    await expect(page.getByRole("button", { name: "New document" })).toBeVisible()
  }

  // An outside reviewer works on what they're given; creating isn't theirs.
  const reviewer = await pageAs("external_reviewer")
  await reviewer.goto("/dashboard")
  await expect(reviewer.getByRole("heading", { level: 1, name: /^Welcome back/ })).toBeVisible()
  await expect(reviewer.getByRole("button", { name: "New document" })).toHaveCount(0)
})

test("New document on home makes one blank document even when double-clicked, and opens it", async ({ admin, pageAs }) => {
  const page = await pageAs("staff")
  await page.goto("/dashboard")
  // Specs share the tenant and run in parallel, so count this page's own
  // create requests rather than the staff member's documents.
  let creates = 0
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) creates += 1
  })

  await page.getByRole("button", { name: "New document" }).dblclick()
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}\/edit\?new=1$/)
  expect(creates).toBe(1)

  const opened = await admin.from("documents").select("title").eq("id", new URL(page.url()).pathname.split("/")[2]!).single()
  if (opened.error) throw opened.error
  expect(opened.data.title).toBe("Untitled document")
})
