import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedSigningDocument, seedTemplate } from "../support/seed"

test("writes on a blank document's own page, adds a field with /, and keeps it all", async ({
  admin,
  pageAs,
  tenant,
}, testInfo) => {
  const page = await pageAs("owner_admin")
  if (testInfo.project.use.viewport) {
    await page.setViewportSize(testInfo.project.use.viewport)
  }
  const title = uniqueName("Welcome letter")

  await page.goto("/documents/new")
  const create = page.getByRole("button", { exact: true, name: "Create" })
  await waitForHydration(create)
  await create.click()
  const dialog = page.getByRole("dialog", { name: "Create document" })
  await dialog.getByLabel("Title").fill(title)
  await dialog.getByRole("button", { name: "Create" }).click()
  await page.waitForURL(/\/documents\/[0-9a-f-]+\/edit/)

  // Blank means an empty page: no printed title, header, or page numbers.
  const emptyPage = page.locator('[data-slot="empty-page"]')
  await waitForHydration(emptyPage)
  await expect(page.locator("[data-printed-title]")).toHaveCount(0)
  await expect(page.getByText(/^Page 1 of/)).toHaveCount(0)

  await emptyPage.click()
  await page.keyboard.type("Dear tenant,")
  await page.keyboard.press("Enter")
  await page.keyboard.type("/sig")
  await expect(page.locator('[data-slot="slash-menu"]')).toContainText("Signature")
  await page.keyboard.press("Enter")
  await expect(page.locator('[data-block-type="signature_field"]')).toBeVisible()

  // The page saves itself: no button to press.
  await expect.poll(async () => {
    const { data, error } = await admin
      .from("documents")
      .select("template_snapshot")
      .eq("org_id", tenant.organizationId)
      .eq("title", title)
      .single()
    if (error) throw error
    return data.template_snapshot.blocks.map((block: { type: string; text?: string }) => block.text ?? block.type)
  }, { timeout: 15_000 }).toEqual(["Dear tenant,", "signature_field"])

  await page.reload()
  await expect(page.getByText("Dear tenant,", { exact: true })).toBeVisible()
  await expect(page.locator('[data-block-type="signature_field"]')).toBeVisible()
})

test("Flow is within reach wherever a document or a template is open", async ({
  admin,
  pageAs,
  tenant,
}, testInfo) => {
  const page = await pageAs("owner_admin")
  if (testInfo.project.use.viewport) {
    await page.setViewportSize(testInfo.project.use.viewport)
  }
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Flow reach"), "published")
  const { documentId } = await seedSigningDocument(
    admin,
    tenant.organizationId,
    template,
    uniqueName("Sent lease"),
    tenant.users.owner_admin.id,
    { email: "signer@example.test", name: "Sam Signer" }
  )
  const flow = page.getByRole("navigation", { name: "Editor tools" }).getByRole("button", { name: "Flow" })

  // Out for signature the words can no longer change, and Flow still answers.
  await page.goto(`/documents/${documentId}/edit`)
  await waitForHydration(flow)
  await flow.click()
  await expect(page.getByLabel("Ask Flow")).toBeVisible()

  // Preview used to put the dock away, and Flow with it.
  await page.goto(`/templates/${template.id}/edit`)
  const preview = page.getByRole("radio", { name: "Preview" })
  await waitForHydration(preview)
  await preview.click()
  await flow.click()
  await expect(page.getByLabel("Ask Flow")).toBeVisible()
})
