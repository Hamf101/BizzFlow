import { expect, test, uniqueName } from "../support/fixtures"
import {
  expectNoActionableAxeViolations,
  expectNoHorizontalPageClipping,
  expectPrimaryRouteSemantics,
  expectReachablePrimaryAction,
  expectVisibleKeyboardFocus,
} from "../support/accessibility"
import {
  seedPublicFormLink,
  seedSigningDocument,
  seedTemplate,
} from "../support/seed"

test.use({ screenshot: "off", trace: "off", video: "off" })

test.describe("representative accessibility evidence", () => {
  test("uses the approved system sans typography without a display face", async ({
    page,
  }) => {
    await page.goto("/login")

    const typography = await page.locator("body").evaluate((body) => {
      const bodyStyle = window.getComputedStyle(body)
      const heading = body.querySelector("h1")

      return {
        body: bodyStyle.fontFamily,
        heading: heading ? window.getComputedStyle(heading).fontFamily : null,
      }
    })

    expect(typography.body).toContain("system-ui")
    expect(typography.heading).toBe(typography.body)
  })

  test("keeps authentication semantics and keyboard focus accessible", async ({
    page,
  }) => {
    await page.goto("/login")

    await expectPrimaryRouteSemantics(page)
    await expectVisibleKeyboardFocus(page)
    await expectNoActionableAxeViolations(page)
  })

  test("keeps representative role routes accessible", async ({ pageAs }) => {
    const routes = [
      { path: "/dashboard", role: "owner_admin" },
      { path: "/documents", role: "owner_admin" },
      { path: "/templates", role: "manager" },
      { path: "/tasks", role: "staff" },
    ] as const

    for (const route of routes) {
      const page = await pageAs(route.role)

      await page.goto(route.path)
      await expectPrimaryRouteSemantics(page)
      await expectNoActionableAxeViolations(page)
    }
  })

  test("announces fixed live action feedback", async ({ pageAs }) => {
    const page = await pageAs("owner_admin")

    await page.goto("/dashboard?feedback=changes_saved")

    const announcement = page.getByRole("status")
    await expect(announcement).toBeVisible()
    await expect(announcement).toContainText("Changes saved")
  })

  test("keeps tokenized public routes accessible without recording their URLs", async ({
    admin,
    page,
    tenant,
  }) => {
    const template = await seedTemplate(
      admin,
      tenant.organizationId,
      uniqueName("Accessible public"),
      "published"
    )
    const publicToken = await seedPublicFormLink(
      admin,
      tenant.organizationId,
      template.id
    )
    const { signingToken } = await seedSigningDocument(
      admin,
      tenant.organizationId,
      template,
      uniqueName("Accessible signing"),
      tenant.users.manager.id,
      { email: "accessible-signer@e2e.bizflow.test", name: "Morgan Lee" }
    )

    await page.goto(`/forms/${publicToken}`)
    await expectPrimaryRouteSemantics(page)
    await expectNoActionableAxeViolations(page)

    await page.goto(`/sign/${signingToken}`)
    await expectPrimaryRouteSemantics(page)
    await expectNoActionableAxeViolations(page)
  })
})

test.describe("responsive interaction evidence", () => {
  test("keeps the approved shell stable across the six viewport classes", async ({
    pageAs,
  }) => {
    const page = await pageAs("owner_admin")
    const viewports = [320, 390, 430, 768, 1024, 1440] as const

    await page.goto("/templates")
    await expect(page.getByRole("link", { name: "Create template" })).toBeVisible()

    for (const width of viewports) {
      await page.setViewportSize({ height: 900, width })

      const desktopSidebar = page.locator("aside")
      const mobileHeader = page.locator("header").first()
      const mobileNavigation = page.getByRole("navigation", {
        name: "Mobile navigation",
      })
      const primaryAction = page.getByRole("link", { name: "Create template" })

      await expectNoHorizontalPageClipping(page)
      await expectReachablePrimaryAction(primaryAction, page)

      if (width < 768) {
        await expect(desktopSidebar).toBeHidden()
        await expect(mobileHeader).toBeVisible()
        await expect(mobileNavigation).toBeVisible()
        await expect(mobileHeader).toHaveCSS("position", "sticky")
        await expect(mobileNavigation).toHaveCSS("position", "fixed")
        await expect(mobileNavigation).toHaveCSS("bottom", "0px")
      } else {
        await expect(desktopSidebar).toBeVisible()
        await expect(mobileHeader).toBeHidden()
        await expect(mobileNavigation).toBeHidden()
      }
    }
  })

  test("keeps the current page still instead of flashing loading UI during navigation", async ({
    pageAs,
  }) => {
    const page = await pageAs("owner_admin")
    await page.setViewportSize({ height: 900, width: 1024 })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/dashboard")
    await page.route("**/*", async (route) => {
      const requestUrl = new URL(route.request().url())

      if (
        route.request().method() === "GET" &&
        requestUrl.pathname === "/documents"
      ) {
        await new Promise((resolve) => setTimeout(resolve, 450))
      }

      await route.continue()
    })

    const documentsLink = page.locator('aside a[href="/documents"]')
    const navigation = documentsLink.click()

    await expect(
      documentsLink.locator('[data-navigation-pending="/documents"]')
    ).toHaveCount(0)
    await expect(page.locator('[data-slot="page-skeleton-content"]')).toHaveCount(
      0
    )

    await navigation
    await expect(page).toHaveURL(/\/documents(?:\?|$)/)
  })
})
