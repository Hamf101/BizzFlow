import { createHash } from "node:crypto"

import type { Page } from "@playwright/test"
import { PDFDocument, StandardFonts } from "pdf-lib"

import { expect, test, uniqueEmail, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"

// A two-page agreement with lines for two people to sign, as people upload them.
async function agreement(): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.TimesRoman)
  for (const heading of ["Residential lease", "Signatures"]) {
    const page = pdf.addPage([612, 792])
    page.drawText(heading, { font, size: 20, x: 72, y: 700 })
    page.drawText("Tenant: ______________   Landlord: ______________", { font, size: 12, x: 72, y: 200 })
  }
  return Buffer.from(await pdf.save())
}

async function placeOn(page: Page, tool: string, at: { x: number; y: number }): Promise<void> {
  await page.getByRole("button", { exact: true, name: tool }).click()
  const first = page.locator('[data-page="1"] [data-pdf-overlay]')
  const box = (await first.boundingBox())!
  await first.click({ position: { x: box.width * at.x, y: box.height * at.y } })
}

async function nameSigner(page: Page, item: RegExp | string, name: string): Promise<void> {
  await page.getByRole("button", { name: /Fields are for/ }).click()
  await page.getByRole("menuitem", { name: item }).click()
  await page.getByRole("textbox", { name: "Name" }).fill(name)
  await page.getByRole("dialog").getByRole("button", { name: /Rename|Add/ }).click()
}

async function sign(page: Page): Promise<void> {
  // Only someone with a signature field draws one.
  const pad = page.locator("#finish canvas").first()
  if ((await pad.count()) > 0) {
    await pad.scrollIntoViewIfNeeded()
    const box = (await pad.boundingBox())!
    await page.mouse.move(box.x + 20, box.y + box.height / 2)
    await page.mouse.down()
    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(box.x + 20 + step * 15, box.y + box.height / 2 + (step % 2 ? -10 : 10))
    }
    await page.mouse.up()
  }
  await page.getByRole("checkbox", { name: /agree to sign this document electronically/ }).check()
  await page.getByRole("button", { name: "Finish signing" }).click()
  await page.waitForURL(/message=/)
}

test("an uploaded PDF is sent as it is: fields for each signer, each signs only theirs, and the signed copy closes with its certificate", async ({
  admin,
  browser,
  pageAs,
  tenant,
}) => {
  const page = await pageAs("owner_admin")
  const title = uniqueName("Lease")

  await page.goto("/documents/new")
  const upload = page.getByLabel("Upload", { exact: true })
  await waitForHydration(upload)
  await upload.setInputFiles({ buffer: await agreement(), mimeType: "application/pdf", name: "Lease.pdf" })
  const dialog = page.getByRole("dialog", { name: "Upload document" })
  await dialog.getByLabel("Title").fill(title)
  await dialog.getByRole("button", { name: "Upload" }).click()
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 30_000 })

  await page.getByRole("link", { name: "Send for signature" }).click()
  await page.locator("canvas").first().waitFor()
  await nameSigner(page, /Rename/, "Tenant")
  await placeOn(page, "Signature", { x: 0.3, y: 0.72 })
  await nameSigner(page, "Add a signer", "Landlord")
  await placeOn(page, "Date", { x: 0.7, y: 0.72 })
  await expect(page.locator('[data-slot="pdf-field"]')).toHaveCount(2)

  // A field moves with the keyboard, and what is placed stays after a reload.
  await page.getByRole("button", { name: "Date for Landlord" }).press("ArrowLeft")
  await expect(page.locator('[data-slot="save-status"]')).toHaveAttribute("data-status", "saved")
  await page.reload()
  await expect(page.locator('[data-slot="pdf-field"]')).toHaveCount(2)

  // A field's size is the sender's to change: drag a side handle, or Alt with an arrow key.
  const date = page.getByRole("button", { name: "Date for Landlord" })
  await date.click()
  const before = (await date.boundingBox())!
  const handle = date.locator('[data-handle="right"]')
  const grip = (await handle.boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2 + 40, grip.y + grip.height / 2, { steps: 4 })
  await page.mouse.up()
  expect((await date.boundingBox())!.width).toBeGreaterThan(before.width + 30)
  const wider = (await date.boundingBox())!
  await date.press("Alt+ArrowDown")
  expect((await date.boundingBox())!.height).toBeGreaterThan(wider.height)

  // From the keyboard alone: a tool places its field in view, focused, and Delete takes it away.
  await page.getByRole("button", { exact: true, name: "Checkbox" }).press("Enter")
  await expect(page.getByRole("button", { name: /^Checkbox for / })).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Delete")
  await expect(page.locator('[data-slot="pdf-field"]')).toHaveCount(2)

  // One field each: the tenant is found in the workspace, the landlord is reached by email.
  const tenantEmail = tenant.users.manager.email
  const landlordEmail = uniqueEmail("landlord")
  await page.getByRole("button", { name: "Send for signature" }).click()
  const tenantField = page.getByRole("combobox", { name: "Who signs as Tenant" })
  await tenantField.fill(tenantEmail.slice(0, 10))
  await page.getByRole("option").filter({ hasText: tenantEmail }).click()
  await expect(tenantField).toHaveValue(new RegExp(`<${tenantEmail.replace(/[.+]/g, "\\$&")}>$`))
  await page.getByRole("combobox", { name: "Who signs as Landlord" }).fill(landlordEmail)
  await page.getByRole("button", { exact: true, name: "Send" }).click()
  await expect(page.getByRole("heading", { name: title })).toBeVisible()

  // Links are stored only as hashes, so the test sets a link of its own for each signer.
  const { data: document } = await admin.from("documents").select("id").eq("org_id", tenant.organizationId).eq("title", title).single()
  const documentId = document!.id as string
  const links: Record<string, string> = {}
  for (const email of [tenantEmail, landlordEmail]) {
    links[email] = `pdf-signing-e2e-${createHash("sha256").update(`${documentId}:${email}`).digest("hex").slice(0, 32)}`
    const { error } = await admin
      .from("document_signing_recipients")
      .update({ token_hash: createHash("sha256").update(links[email]!, "utf8").digest("hex") })
      .eq("document_id", documentId)
      .eq("email", email)
    if (error) throw error
  }

  // The tenant sees their signature field live and the landlord's date greyed.
  const tenantPage = await (await browser.newContext()).newPage()
  await tenantPage.goto(`/sign/${links[tenantEmail]}`)
  await tenantPage.locator("canvas").first().waitFor()
  await expect(tenantPage.locator('[data-slot="pdf-field-other"]')).toHaveText(["Landlord"])
  await expect(tenantPage.locator("input[type=date]")).toHaveCount(0)
  await sign(tenantPage)
  await expect(tenantPage.getByText(`Waiting for ${landlordEmail}`)).toBeVisible()

  // The landlord's Next field takes them to their date; they sign last.
  const landlordPage = await (await browser.newContext()).newPage()
  await landlordPage.goto(`/sign/${links[landlordEmail]}`)
  await landlordPage.locator("canvas").first().waitFor()
  await landlordPage.getByRole("button", { exact: true, name: "Next field" }).click()
  await expect(landlordPage.locator("input[type=date]")).toBeFocused()
  await landlordPage.locator("input[type=date]").fill("2026-10-22")
  await sign(landlordPage)
  await expect(landlordPage.getByText("Everyone has signed")).toBeVisible()

  const { data: answer } = await admin.from("document_answers").select("workflow_status").eq("document_id", documentId).single()
  expect(answer!.workflow_status).toBe("completed")
  const { data: signers } = await admin.from("document_signing_recipients").select("status,consented_at").eq("document_id", documentId)
  expect(signers!.every((signer) => signer.status === "signed" && signer.consented_at)).toBe(true)

  // The signed copy is made right after the last signature, and both signers and the sender are sent it.
  await expect
    .poll(async () => (await admin.from("document_signed_copy_links").select("id", { count: "exact", head: true }).eq("document_id", documentId)).count, { timeout: 20_000 })
    .toBe(3)
})
