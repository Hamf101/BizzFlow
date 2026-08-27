import { expect, test } from "../support/fixtures"

test.describe("authentication redirects", () => {
  test("keeps a normalized authority redirect inside BizFlow", async ({
    browser,
    tenant,
  }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    const unsafeNextPath = "/..//evil.example"
    const expectedOrigin = new URL(
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
    ).origin

    await page.goto(`/login?next=${encodeURIComponent(unsafeNextPath)}`)
    await page.getByLabel("Email").fill(tenant.users.manager.email)
    await page.getByLabel("Password").fill(tenant.users.manager.password)
    await page.getByRole("button", { name: "Sign in" }).click()
    await page.waitForURL((url) => url.pathname === "/dashboard")

    const destination = new URL(page.url())
    expect(destination.origin).toBe(expectedOrigin)
    expect(destination.pathname).toBe("/dashboard")
    expect(destination.href).not.toContain("evil.example")

    await context.close()
  })
})
