import { createHash } from "node:crypto"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
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

    await expect(page.getByRole("heading", { level: 1, name: template.title })).toBeVisible()

    await page.getByLabel("Client reference").fill("EXT-9001")
    await page.getByRole("button", { name: "Submit" }).click()

    await page.waitForURL(/\/forms\/.+\/success/)
    await expect(page.getByText("Submission received")).toBeVisible()

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

    await expect
      .poll(async (): Promise<number | undefined> => {
        const { data } = await admin
          .from("public_form_links")
          .select("submission_count")
          .eq("token_hash", createHash("sha256").update(token, "utf8").digest("hex"))
          .single()

        return data?.submission_count as number | undefined
      })
      .toBe(1)
  })

  test("can be read and typed into before its code arrives on a slow connection, and keeps what was typed", async ({
    admin,
    browser,
    tenant,
  }) => {
    const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Slow"), "published")
    const token = await seedPublicFormLink(admin, tenant.organizationId, template.id)
    const context = await browser.newContext()
    const page = await context.newPage()
    let arrive = (): void => undefined
    const code = new Promise<void>((resolve) => (arrive = resolve))
    let held = 0

    // The page's code is held back until the visitor has typed.
    await page.route("**/_next/static/chunks/**/*.js", async (route) => {
      held += 1
      await code
      await route.continue()
    })
    await page.goto(`/forms/${token}`, { waitUntil: "commit" })

    const field = page.getByLabel("Client reference")
    await field.fill("EXT-9002")
    // Typing happened while code really was being held.
    expect(held).toBeGreaterThan(0)
    arrive()
    await waitForHydration(field)
    await expect(field).toHaveValue("EXT-9002")

    await page.getByRole("button", { name: "Submit" }).click()
    await page.waitForURL(/\/forms\/.+\/success/)
    await context.close()
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

    const { error } = await admin
      .from("public_form_links")
      .update({ status: "disabled" })
      .eq("token_hash", createHash("sha256").update(token, "utf8").digest("hex"))
    if (error) throw error

    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(`/forms/${token}`)

    // Revoking a link has to take effect immediately — it is the only control a
    // tenant has once a URL is loose.
    await expect(page.getByRole("heading", { level: 1, name: "Link turned off" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Submit" })).toHaveCount(0)

    await context.close()
  })
})
