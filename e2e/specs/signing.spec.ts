import type { Page } from "@playwright/test"

import { expect, test, uniqueName } from "../support/fixtures"
import { seedSigningDocument, seedTemplate } from "../support/seed"

/**
 * Journey 5 — open a private signing link, sign it, and get a real PDF back.
 *
 * The signing page is the only part of the product a stranger touches, and it
 * runs with no session at all: authorisation is the token and nothing else. So
 * this spec deliberately uses a context with no cookies, and checks both halves
 * of that bargain — a valid token gets in, a wrong one does not.
 */
test.describe("signing", () => {
  test("signs a document by token and produces a downloadable PDF", async ({
    admin,
    browser,
    pageAs,
    tenant,
  }) => {
    const template = await seedTemplate(
      admin,
      tenant.organizationId,
      uniqueName("Signable"),
      "published"
    )
    const title = uniqueName("Agreement")
    const { documentId, signingToken } = await seedSigningDocument(
      admin,
      tenant.organizationId,
      template,
      title,
      tenant.users.manager.id,
      { email: "counterparty@e2e.bizflow.test", name: "Avery Morgan" }
    )

    // No storage state: a signer is not a member and must never need to be.
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(`/sign/${signingToken}`)

    const titleHeadings = page.getByRole("heading", {
      exact: true,
      level: 1,
      name: title,
    })

    await expect(titleHeadings).toHaveCount(2)
    await expect(titleHeadings.first()).toBeVisible()
    await expect(page.getByText("Signing status")).toBeVisible()

    await drawSignature(page, "Signature drawing area")

    await page.getByRole("button", { name: "Submit signature" }).click()

    await expect(page.getByText(/your signature is recorded/i)).toBeVisible()

    await expect
      .poll(async (): Promise<string | undefined> => {
        const { data } = await admin
          .from("document_signing_recipients")
          .select("status")
          .eq("document_id", documentId)
          .single()

        return data?.status as string | undefined
      })
      .toBe("signed")

    await context.close()

    // The rendered document is what the customer keeps, so check it is a PDF
    // rather than an error page with a 200.
    const manager = await pageAs("manager")
    const response = await manager.request.get(
      `/api/documents/${documentId}/pdf`
    )

    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toContain("application/pdf")

    const body = await response.body()

    expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })

  test("rejects an unknown signing token", async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto("/sign/e2e-sign-not-a-real-token")

    await expect(page.getByText(/signing link unavailable/i)).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Submit signature" })
    ).toBeHidden()

    await context.close()
  })
})

/**
 * Draws a short stroke on a signature canvas.
 *
 * The field only records a value once a pointer stroke has actually marked the
 * canvas — it refuses to accept a blank drawing as a signature — so the stroke
 * has to be real rather than a synthetic value written into the hidden input.
 *
 * @param page - Page showing the signing form.
 * @param label - Accessible name of the canvas.
 * @returns Resolves once the stroke is complete.
 */
async function drawSignature(page: Page, label: string): Promise<void> {
  const canvas = page.getByRole("img", { name: label })

  await expect(canvas).toBeVisible()
  await canvas.scrollIntoViewIfNeeded()

  const box = await canvas.boundingBox()

  if (!box) {
    throw new Error(`Could not measure the ${label} canvas.`)
  }

  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3, {
    steps: 8,
  })
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, {
    steps: 8,
  })
  await page.mouse.up()

  await expect(
    canvas.locator("xpath=ancestor::*[@data-slot='field'][1]").getByRole(
      "button",
      { name: "Clear" }
    )
  ).toBeEnabled()
}
