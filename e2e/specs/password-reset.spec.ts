import type { Page } from "@playwright/test"

import { expect, test, uniqueName } from "../support/fixtures"

function address(label: string): string {
  return `${uniqueName(label).toLowerCase().replace(/[^a-z0-9]+/g, "-")}@e2e.bizflow.test`
}

test("a forgotten password is replaced from the emailed link, and only the new one signs in", async ({
  admin,
  browser,
}) => {
  const email = address("reset")
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: "Old-passw0rd!",
  })
  if (error) throw error
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    // Asking for a link reads the same whether or not the address has an account.
    await page.goto("/login")
    await page.getByRole("link", { name: "Forgot password?" }).click()
    // Log in has an Email field too; fill the one on the page we moved to.
    await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible()
    await page.getByLabel("Email").fill(address("nobody"))
    await page.getByRole("button", { name: "Email me a link" }).click()
    await expect(page.getByText("If an account uses that address")).toBeVisible()

    // The email carries a link to the new-password page; this one is made the same way.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ email, type: "recovery" })
    if (linkError) throw linkError
    await page.goto(`/reset-password?token_hash=${encodeURIComponent(link.properties.hashed_token)}`)
    await page.getByLabel("New password", { exact: true }).fill("New-passw0rd!")
    await page.getByLabel("Confirm new password").fill("New-passw0rd!")
    await page.getByRole("button", { name: "Save password" }).click()
    await page.waitForURL(/\/dashboard/)
    await context.clearCookies()

    // The old password no longer signs in, and the new one does.
    await signIn(page, email, "Old-passw0rd!")
    await expect(page.getByText("Invalid email or password.")).toBeVisible()
    await signIn(page, email, "New-passw0rd!")
    await page.waitForURL(/\/dashboard/)
  } finally {
    await context.close()
    await admin.auth.admin.deleteUser(created.user.id)
  }
})

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByRole("textbox", { name: "Password" }).fill(password)
  await page.getByRole("button", { name: "Log in" }).click()
}
