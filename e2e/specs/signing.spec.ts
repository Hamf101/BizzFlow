import { createHash, randomUUID } from "node:crypto"

import type { Browser, Page } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"

import { expect, test, uniqueEmail, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
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

    const routeHeading = page.getByRole("heading", {
      exact: true,
      level: 1,
      name: title,
    })
    const documentHeading = page.getByRole("heading", {
      exact: true,
      level: 2,
      name: title,
    })

    await expect(routeHeading).toHaveCount(1)
    await expect(routeHeading).toBeVisible()
    await expect(documentHeading).toHaveCount(1)
    await expect(documentHeading).toBeVisible()
    await expect(page.getByText("Signing status")).toBeVisible()

    await drawSignature(page, "Signature drawing area")

    // Without agreeing to sign electronically, submitting signs nothing.
    await page.getByRole("button", { name: "Submit signature" }).click()
    await expect(page.getByText("Your signature is recorded", { exact: true })).toBeHidden()
    await page.getByRole("checkbox", { name: /I agree to sign electronically/ }).check()
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

  test("the sender edits a document part-signed, sends it again, and once signed edits a copy", async ({
    admin,
    browser,
    pageAs,
    tenant,
  }) => {
    // A document cannot hold an upload field, so this template has only the text field.
    const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Resendable"), "published", [
      { fieldKey: "client_reference", helpText: null, id: randomUUID(), label: "Client reference", multiline: false, placeholder: null, required: true, type: "text_field" },
    ])
    const title = uniqueName("Lease")
    const { data: document, error } = await admin
      .from("documents")
      .insert({
        created_by: tenant.users.manager.id,
        org_id: tenant.organizationId,
        source_kind: "generated",
        template_id: template.id,
        template_revision: 1,
        template_snapshot: template.content,
        title,
      })
      .select("id")
      .single()
    if (error) throw error
    const documentId = document.id as string
    const { error: answersError } = await admin.from("document_answers").insert({
      document_id: documentId,
      org_id: tenant.organizationId,
      values: { [template.textFieldKey]: "REF-5120" },
      workflow_status: "draft",
    })
    if (answersError) throw answersError
    const signers = [
      { email: uniqueEmail("first-signer"), name: "Avery Morgan" },
      { email: uniqueEmail("second-signer"), name: "Blake Rivera" },
    ]

    const sender = await pageAs("manager")
    const editor = `/documents/${documentId}/edit`
    const sendTo = async (): Promise<Record<string, string>> => {
      const send = sender.getByRole("button", { exact: true, name: "Send" })
      await waitForHydration(send)
      await send.click()
      const dialog = sender.getByRole("dialog", { name: "Send for signing" })
      await dialog.getByRole("button", { name: "Add recipient" }).click()
      for (const [index, signer] of signers.entries()) {
        await dialog.getByLabel("Name").nth(index).fill(signer.name)
        await dialog.getByLabel("Email").nth(index).fill(signer.email)
      }
      await dialog.getByRole("button", { exact: true, name: "Send" }).click()
      // Sent or not, the action lands back on the editor with its feedback.
      await sender.waitForURL(/[?&]feedback=/)
      // E2E has no email, so the invitations are not delivered; the signers
      // are saved all the same, and their links are given known tokens here.
      let tokens: [string, string][] = []
      await expect.poll(async () => (tokens = await rekeySigners(admin, documentId)).length).toBe(2)
      return Object.fromEntries(tokens)
    }

    await sender.goto(`/documents/${documentId}`)
    await sender.waitForURL(`**${editor}`)
    const firstRound = await sendTo()
    await signAs(browser, firstRound[signers[0]!.email]!, title)

    // Editing cancels the round: the dialog says what is lost.
    await sender.goto(editor)
    const edit = sender.getByRole("button", { exact: true, name: "Edit" })
    await waitForHydration(edit)
    await edit.click()
    const confirm = sender.getByRole("dialog", { name: "Edit this document?" })
    await expect(confirm).toContainText("1 signature so far will be cancelled")
    await confirm.getByRole("button", { name: "Edit document" }).click()

    const titleField = sender.getByRole("textbox", { name: "Title" })
    await expect(titleField).toBeEditable()
    await waitForHydration(titleField)
    await titleField.fill(`${title} revised`)
    await titleField.press("Tab")
    await expect
      .poll(async () => (await admin.from("documents").select("title").eq("id", documentId).single()).data?.title)
      .toBe(`${title} revised`)

    // The first signer's link from the cancelled round opens nothing.
    const stale = await browser.newContext()
    const stalePage = await stale.newPage()
    await stalePage.goto(`/sign/${firstRound[signers[0]!.email]!}`)
    await expect(stalePage.getByText(/signing link unavailable/i)).toBeVisible()
    await stale.close()

    const secondRound = await sendTo()
    for (const signer of signers) {
      await signAs(browser, secondRound[signer.email]!, `${title} revised`)
    }
    await expect
      .poll(async () => (await admin.from("document_answers").select("workflow_status").eq("document_id", documentId).single()).data?.workflow_status)
      .toBe("completed")

    // Completed stays fixed; its copy is a new draft, open to edit.
    await sender.goto(editor)
    const more = sender.getByRole("button", { name: "More" })
    await waitForHydration(more)
    await more.click()
    await sender.getByRole("menuitem", { name: "Edit a copy" }).click()
    await sender.waitForURL((url) => /\/documents\/[0-9a-f-]+\/edit/.test(url.pathname) && !url.pathname.includes(documentId))
    const copyId = new URL(sender.url()).pathname.split("/")[2] as string
    await expect(sender.getByRole("textbox", { name: "Title" })).toBeEditable()
    const [{ data: copy }, { count: copySigners }] = await Promise.all([
      admin.from("document_answers").select("workflow_status,values").eq("document_id", copyId).single(),
      admin.from("document_signing_recipients").select("id", { count: "exact", head: true }).eq("document_id", copyId),
    ])
    expect(copy).toEqual({ values: { [template.textFieldKey]: "REF-5120" }, workflow_status: "draft" })
    expect(copySigners).toBe(0)
  })
})

/**
 * Gives a document's current signers known tokens, as `seedSigningDocument`
 * does: links keep only a token's SHA-256, so a spec cannot read one back.
 *
 * @param admin - Service-role client.
 * @param documentId - The document out for signing.
 * @returns Each current signer's email and token.
 */
async function rekeySigners(admin: SupabaseClient, documentId: string): Promise<[string, string][]> {
  const { data, error } = await admin
    .from("document_signing_recipients")
    .select("id,email")
    .eq("document_id", documentId)
    .eq("status", "pending")
    .is("revoked_at", null)
  if (error) throw error

  return Promise.all(
    data.map(async ({ email, id }): Promise<[string, string]> => {
      const token = `e2e-sign-${randomUUID()}`
      const { error: updateError } = await admin
        .from("document_signing_recipients")
        .update({ token_hash: createHash("sha256").update(token, "utf8").digest("hex") })
        .eq("id", id)
      if (updateError) throw updateError
      return [email as string, token]
    })
  )
}

/**
 * Signs as a stranger holding only the token, and waits for it to be recorded.
 *
 * @param browser - Browser to open a cookie-less context in.
 * @param token - The signer's link token.
 * @param title - The document title the signing page shows.
 */
async function signAs(browser: Browser, token: string, title: string): Promise<void> {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(`/sign/${token}`)
  await expect(page.getByRole("heading", { exact: true, level: 1, name: title })).toBeVisible()
  await drawSignature(page, "Signature drawing area")
  await page.getByRole("checkbox", { name: /I agree to sign electronically/ }).check()
  await page.getByRole("button", { name: "Submit signature" }).click()
  await expect(page.getByText(/your signature is recorded/i)).toBeVisible()
  await context.close()
}

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
