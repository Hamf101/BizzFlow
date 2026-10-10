import { expect, expectSaved, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedSigningDocument, seedTemplate } from "../support/seed"

test("writes on a blank document's own page, adds a field with /, and keeps it all", async ({
  admin,
  pageAs,
}) => {
  const page = await pageAs("owner_admin")
  const title = uniqueName("Welcome letter")

  await page.goto("/documents/new")
  const create = page.getByRole("button", { exact: true, name: "Create" })
  await waitForHydration(create)
  await create.click()
  const dialog = page.getByRole("dialog", { name: "Create document" })
  await dialog.getByLabel("Title").fill(title)
  await dialog.getByRole("button", { name: "Create" }).click()
  await page.waitForURL(/\/documents\/[0-9a-f-]+\/edit/)
  const documentId = new URL(page.url()).pathname.split("/")[2] as string

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
  await expectSaved(admin, "documents", documentId, ({ blocks }) => blocks.map(({ text, type }) => text ?? type)).toEqual([
    "Dear tenant,",
    "signature_field",
  ])

  await page.reload()
  await expect(page.getByText("Dear tenant,", { exact: true })).toBeVisible()
  await expect(page.locator('[data-block-type="signature_field"]')).toBeVisible()
})

test("Flow is within reach wherever a document or a template is open", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const page = await pageAs("owner_admin")
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Flow reach"), "published")
  const { documentId } = await seedSigningDocument(
    admin,
    tenant.organizationId,
    template,
    uniqueName("Sent lease"),
    tenant.users.owner_admin.id,
    { email: "signer@example.test", name: "Sam Signer" }
  )
  const flow = page.locator('[data-slot="flow-launcher"]')

  // Out for signature the words can no longer change, and Flow still answers.
  await page.goto(`/documents/${documentId}/edit`)
  await waitForHydration(flow)
  await flow.click()
  await expect(page.getByLabel("Ask Flow")).toBeVisible()

  // A template's editor has Flow's button too.
  await page.goto(`/templates/${template.id}/edit`)
  await waitForHydration(flow)
  await flow.click()
  await expect(page.getByLabel("Ask Flow")).toBeVisible()
})

test("Flow is one press away on every workspace page", async ({ isMobile, pageAs }) => {
  const page = await pageAs("staff")
  const launcher = page.locator('[data-slot="flow-launcher"]')

  for (const path of ["/dashboard", "/documents", "/tasks"]) {
    await page.goto(path)
    await waitForHydration(launcher)
    await launcher.click()
    await expect(page.getByRole("dialog", { name: "Flow" }).getByLabel("Ask Flow")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: "Flow" })).toBeHidden()
  }

  // On a phone it floats above the tab bar, never on top of a tab.
  if (isMobile) {
    const button = await launcher.boundingBox()
    const bar = await page.getByRole("navigation", { name: "Mobile navigation" }).boundingBox()
    expect(button!.y + button!.height).toBeLessThanOrEqual(bar!.y)
  }
})
