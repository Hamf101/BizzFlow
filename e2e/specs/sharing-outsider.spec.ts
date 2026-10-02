import { createHash, randomBytes } from "node:crypto"

import { expect, test, uniqueName } from "../support/fixtures"
import { seedSigningDocument, seedTemplate } from "../support/seed"

/**
 * Someone outside the workspace opens the one document emailed to them: they
 * make an account from the link, read the document, can't change it or reach
 * anything else, and lose it when their access is removed.
 *
 * The invite email holds the only copy of the token, so the grant is seeded
 * with a token chosen here and stored as its hash, like the app stores it.
 */
test("an outsider opens a shared document from the link, only reads it, and loses it when removed", async ({
  admin,
  browser,
  tenant,
}) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Outsider lease template"), "published")
  const owner = tenant.users.owner_admin.id
  const shared = await seedSigningDocument(admin, tenant.organizationId, template, uniqueName("Outsider lease"), owner, {
    email: "signer@e2e.bizflow.test",
    name: "Signer",
  })
  const other = await seedSigningDocument(admin, tenant.organizationId, template, uniqueName("Payroll"), owner, {
    email: "signer@e2e.bizflow.test",
    name: "Signer",
  })
  const { data: sharedDocument } = await admin.from("documents").select("title").eq("id", shared.documentId).single()
  const email = `outsider-${randomBytes(6).toString("hex")}@e2e.bizflow.test`
  const token = randomBytes(32).toString("base64url")
  const { error } = await admin.from("document_guest_grants").insert({
    access_level: "viewer",
    document_id: shared.documentId,
    email,
    invite_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    invite_token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
    invited_by: owner,
    org_id: tenant.organizationId,
  })
  expect(error).toBeNull()

  const context = await browser.newContext()
  const page = await context.newPage()
  const password = "e2e-BizFlow-Passw0rd"

  try {
    await page.goto(`/shared/${token}`)
    await expect(page.getByRole("heading", { name: new RegExp(`shared “${sharedDocument?.title as string}” with you`) })).toBeVisible()
    await page.getByLabel("Your name").fill("Ana Outsider")
    await page.getByLabel("Choose a password").fill(password)
    await page.getByLabel("Confirm password").fill(password)
    await page.getByRole("button", { name: "Open the document" }).click()

    await page.waitForURL(`**/documents/${shared.documentId}/preview`)
    await expect(page.getByText(sharedDocument?.title as string).first()).toBeVisible()
    await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible()
    // A reader: nothing to change it with, nobody to share it with.
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Share" })).toHaveCount(0)

    const pdf = await page.request.get(`/api/documents/${shared.documentId}/pdf`)
    expect(pdf.status()).toBe(200)
    expect(pdf.headers()["content-type"]).toBe("application/pdf")

    // The editor sends them back to reading.
    await page.goto(`/documents/${shared.documentId}/edit`)
    await page.waitForURL(`**/documents/${shared.documentId}/preview`)

    // Nothing else in that workspace opens for them.
    expect((await page.request.get(`/api/documents/${other.documentId}/pdf`)).status()).toBeGreaterThanOrEqual(400)

    // The link worked once.
    await page.goto(`/shared/${token}`)
    await expect(page.getByRole("heading", { name: "This link no longer works" })).toBeVisible()

    // Removing them takes it away.
    await admin.from("document_guest_grants").delete().eq("document_id", shared.documentId).eq("email", email)
    expect((await page.request.get(`/api/documents/${shared.documentId}/pdf`)).status()).toBeGreaterThanOrEqual(400)
  } finally {
    await context.close()
  }
})
