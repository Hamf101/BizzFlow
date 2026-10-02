import { createHash, randomBytes } from "node:crypto"

import type { Browser } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
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
  const { context, page, token } = await joinAsGuest(admin, browser, {
    accessLevel: "viewer",
    documentId: shared.documentId,
    invitedBy: owner,
    organizationId: tenant.organizationId,
  })

  try {
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

    // Their home is what was shared with them, even from the dashboard.
    await page.goto("/dashboard")
    await page.waitForURL("**/shared")
    await expect(page.getByRole("link", { name: new RegExp(sharedDocument?.title as string) })).toBeVisible()

    // The link worked once.
    await page.goto(`/shared/${token}`)
    await expect(page.getByRole("heading", { name: "This link no longer works" })).toBeVisible()

    // Removing them takes it away.
    await admin.from("document_guest_grants").delete().eq("document_id", shared.documentId)
    expect((await page.request.get(`/api/documents/${shared.documentId}/pdf`)).status()).toBeGreaterThanOrEqual(400)
    await page.goto("/shared")
    await expect(page.getByText("Nothing is shared with you right now.")).toBeVisible()
  } finally {
    await context.close()
  }
})

// Invites someone new to one document and walks them through the link,
// returning their signed-in page.
async function joinAsGuest(
  admin: SupabaseClient,
  browser: Browser,
  grant: { accessLevel: "contributor" | "viewer"; documentId: string; invitedBy: string; organizationId: string }
) {
  const email = `outsider-${randomBytes(6).toString("hex")}@e2e.bizflow.test`
  const token = randomBytes(32).toString("base64url")
  const { error } = await admin.from("document_guest_grants").insert({
    access_level: grant.accessLevel,
    document_id: grant.documentId,
    email,
    invite_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    invite_token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
    invited_by: grant.invitedBy,
    org_id: grant.organizationId,
  })
  expect(error).toBeNull()

  const context = await browser.newContext()
  const page = await context.newPage()
  const password = "e2e-BizFlow-Passw0rd"
  await page.goto(`/shared/${token}`)
  await expect(page.getByRole("heading", { name: /shared “.+” with you/ })).toBeVisible()
  await page.getByLabel("Your name").fill("Ed Outsider")
  await page.getByLabel("Choose a password").fill(password)
  await page.getByLabel("Confirm password").fill(password)
  await page.getByRole("button", { name: "Open the document" }).click()
  await page.waitForURL(`**/documents/${grant.documentId}/preview`)

  return { context, page, token }
}

test("an outsider given a draft as an Editor changes it alongside the workspace, but cannot send or share it", async ({
  admin,
  browser,
  tenant,
}) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Outsider draft template"), "published")
  const owner = tenant.users.owner_admin.id
  const title = uniqueName("Outsider draft")
  const { data: document, error } = await admin
    .from("documents")
    .insert({
      created_by: owner,
      org_id: tenant.organizationId,
      source_kind: "generated",
      template_id: template.id,
      template_revision: 1,
      template_snapshot: template.content,
      title,
    })
    .select("id")
    .single()
  expect(error).toBeNull()
  const documentId = document?.id as string
  await admin.from("document_answers").insert({ document_id: documentId, org_id: tenant.organizationId, values: {}, workflow_status: "draft" })

  const guest = await joinAsGuest(admin, browser, { accessLevel: "contributor", documentId, invitedBy: owner, organizationId: tenant.organizationId })
  const { page } = guest

  try {
    await page.getByRole("link", { name: "Edit" }).click()
    await page.waitForURL(`**/documents/${documentId}/edit`)
    const titleField = page.getByLabel("Title", { exact: true })
    await waitForHydration(titleField)
    await expect(page.getByRole("button", { name: "Send" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /Flow/ })).toHaveCount(0)

    // Answers and the page both save from their side, in the workspace's document.
    await page.getByLabel("Client reference").fill("REF-GUEST")
    await titleField.fill(`${title} edited`)
    await titleField.press("Tab")

    await expect.poll(async () => {
      const [{ data: answers }, { data: saved }] = await Promise.all([
        admin.from("document_answers").select("values").eq("document_id", documentId).single(),
        admin.from("documents").select("title,updated_by").eq("id", documentId).single(),
      ])
      return { reference: answers?.values?.client_reference ?? null, title: saved?.title }
    }, { timeout: 15_000 }).toEqual({ reference: "REF-GUEST", title: `${title} edited` })
  } finally {
    await guest.context.close()
  }
})
