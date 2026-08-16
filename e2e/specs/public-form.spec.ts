import { expect, test, uniqueName } from "../support/fixtures"
import { seedPublicFormLink, seedTemplate } from "../support/seed"

/**
 * Journey 6 — an external visitor completes a public form.
 *
 * This is the widest part of the attack surface: no account, no membership, and
 * a token that anyone with the link holds. The spec runs with an empty browser
 * context throughout, so anything that quietly depended on a session would fail
 * here rather than in production.
 */
test.describe("public form", () => {
  test("accepts an anonymous submission through a shared link", async ({
    admin,
    browser,
    tenant,
  }) => {
    const template = await seedTemplate(
      admin,
      tenant.organizationId,
      uniqueName("Public"),
      "published"
    )
    const token = await seedPublicFormLink(
      admin,
      tenant.organizationId,
      template.id
    )

    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(`/forms/${token}`)

    await expect(page.getByText(template.title)).toBeVisible()

    await page.getByLabel("Client reference").fill("EXT-9001")
    await page.getByRole("button", { name: "Submit form" }).click()

    await page.waitForURL(/\/forms\/.+\/success/)
    await expect(page.getByText("Submission Received")).toBeVisible()

    await context.close()

    // The visitor sees a thank-you page either way; what matters is that a row
    // reached the tenant, attributed to the right template.
    await expect
      .poll(async (): Promise<number> => {
        const { count } = await admin
          .from("submissions")
          .select("id", { count: "exact", head: true })
          .eq("org_id", tenant.organizationId)
          .eq("template_id", template.id)

        return count ?? 0
      })
      .toBeGreaterThan(0)
  })

  test("refuses a disabled link", async ({ admin, browser, tenant }) => {
    const template = await seedTemplate(
      admin,
      tenant.organizationId,
      uniqueName("Disabled"),
      "published"
    )
    const token = await seedPublicFormLink(
      admin,
      tenant.organizationId,
      template.id
    )

    await admin
      .from("public_form_links")
      .update({ status: "disabled" })
      .eq("token", token)

    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(`/forms/${token}`)

    // Revoking a link has to take effect immediately — it is the only control a
    // tenant has once a URL is loose.
    await expect(
      page.getByRole("button", { name: "Submit form" })
    ).toBeHidden()

    await context.close()
  })
})
