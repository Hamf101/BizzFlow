import { expect, test, uniqueName } from "../support/fixtures"
import {
  expectNoActionableAxeViolations,
  expectPrimaryRouteSemantics,
  expectVisibleKeyboardFocus,
} from "../support/accessibility"
import {
  seedPublicFormLink,
  seedSigningDocument,
  seedTemplate,
} from "../support/seed"

test.use({ screenshot: "off", trace: "off", video: "off" })

test.describe("representative accessibility evidence", () => {
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
