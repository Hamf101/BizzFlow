import type { Locator } from "@playwright/test"

import type { OrganizationRole } from "@/lib/permissions"

import { expectStandaloneTargets } from "../support/accessibility"
import { expect, test } from "../support/fixtures"

type MobileRole = Extract<OrganizationRole, "owner_admin" | "manager" | "staff">

const FULL_MEMBER_ROUTES = [
  "/dashboard",
  "/people",
  "/documents",
  "/templates",
  "/submissions",
  "/tasks",
  "/audit-log",
  "/settings",
] as const

const ROLE_ROUTES: ReadonlyArray<{
  forbidden: readonly string[]
  role: MobileRole
  routes: readonly string[]
}> = [
  { forbidden: [], role: "owner_admin", routes: FULL_MEMBER_ROUTES },
  { forbidden: [], role: "manager", routes: FULL_MEMBER_ROUTES },
  {
    forbidden: ["/audit-log"],
    role: "staff",
    routes: FULL_MEMBER_ROUTES.filter((route) => route !== "/audit-log"),
  },
]

test.describe("mobile navigation", () => {
  for (const { forbidden, role, routes } of ROLE_ROUTES) {
    test(`${role} reaches every authorized route and never exposes forbidden destinations`, async ({
      pageAs,
    }) => {
      const page = await pageAs(role)

      await page.goto("/dashboard")

      expect(await page.evaluate(() => window.innerWidth)).toBeLessThan(768)
      await expect(page.locator("aside")).toBeHidden()
      await expect(
        page.getByRole("link", { name: "BizFlow dashboard" })
      ).toBeVisible()
      await expect(
        page.getByRole("button", { name: /open account menu/i })
      ).toBeVisible()

      await assertForbiddenDestinationsAbsent(page, forbidden)

      const navigation = page.getByRole("navigation", {
        name: "Mobile navigation",
      })
      await expect(navigation).toBeVisible()
      await expectStandaloneTargets(navigation.locator("a, button"))

      const more = navigation.getByRole("button", { name: "More" })
      await more.click()
      const dialog = page.getByRole("dialog", { name: "More" })
      await expect(dialog).toBeVisible()
      await expectStandaloneTargets(dialog.locator("a, button"))
      await page.keyboard.press("Escape")
      await expect(dialog).toBeHidden()
      await expect(more).toBeFocused()

      for (const route of routes) {
        await navigateThroughMobileShell(page, route)
        await expect(page).toHaveURL(new RegExp(`${route}$`))
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)
        await assertForbiddenDestinationsAbsent(page, forbidden)
      }
    })
  }

  test("keeps the wordmark clear of the account menu in the phone header", async ({
    pageAs,
  }) => {
    const page = await pageAs("owner_admin")
    await page.goto("/dashboard")

    const header = page.getByRole("banner")
    const [wordmark, account, bar] = await Promise.all([
      readBox(header.getByText("BizFlow", { exact: true })),
      readBox(header.getByRole("button", { name: /open account menu/i })),
      readBox(header),
    ])

    // The whole wordmark ends before the account menu begins, and the menu
    // sits at the header's right edge rather than wherever space runs out.
    expect(wordmark.x + wordmark.width).toBeLessThanOrEqual(account.x)
    expect(bar.x + bar.width - (account.x + account.width)).toBeLessThanOrEqual(24)
  })
})

async function readBox(
  locator: Locator
): Promise<{ height: number; width: number; x: number; y: number }> {
  const box = await locator.boundingBox()

  if (!box) {
    throw new Error("Expected a rendered element with a layout box.")
  }

  return box
}

async function navigateThroughMobileShell(
  page: import("@playwright/test").Page,
  route: string
): Promise<void> {
  if (new URL(page.url()).pathname === route) {
    return
  }

  const navigation = page.getByRole("navigation", {
    name: "Mobile navigation",
  })
  const primaryLink = navigation.locator(`a[href="${route}"]`)

  if (await primaryLink.isVisible()) {
    await primaryLink.click()
    return
  }

  await navigation.getByRole("button", { name: "More" }).click()
  await page.getByRole("dialog", { name: "More" }).locator(`a[href="${route}"]`).click()
}

async function assertForbiddenDestinationsAbsent(
  page: import("@playwright/test").Page,
  routes: readonly string[]
): Promise<void> {
  for (const route of routes) {
    await expect(page.locator(`a[href="${route}"]`)).toHaveCount(0)
    await expect(
      page.locator(`link[rel="prefetch"][href="${route}"]`)
    ).toHaveCount(0)
  }
}
