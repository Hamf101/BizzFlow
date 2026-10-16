import { expect, expectSaved, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedSigningDocument, seedTemplate } from "../support/seed"

test("a blank document opens in one click with the cursor on the page, takes a field with /, and keeps it all", async ({
  admin,
  pageAs,
}) => {
  const page = await pageAs("owner_admin")

  await page.goto("/documents/new")
  const blank = page.getByRole("button", { name: "Blank document" })
  await waitForHydration(blank)
  await blank.click()
  await page.waitForURL(/\/documents\/[0-9a-f-]+\/edit/)
  const documentId = new URL(page.url()).pathname.split("/")[2] as string

  // Blank means an empty page: no printed title, header, or page numbers.
  await expect(page.locator("[data-printed-title]")).toHaveCount(0)
  await expect(page.getByText(/^Page 1 of/)).toHaveCount(0)

  // Like a word processor: the cursor is already on the page, so typing just works.
  await expect(page.locator('[contenteditable="true"]:focus')).toHaveCount(1)
  await page.keyboard.type("Dear tenant,")
  await page.keyboard.press("Enter")
  await page.keyboard.type("/sig")
  // Every key after the / lands: the menu narrows to Signature and has it chosen.
  await expect(page.locator('[data-slot="slash-menu"] [aria-selected="true"]')).toHaveText(/Signature/)
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

test("New template opens an untitled draft in one click, with the cursor on its page", async ({ admin, pageAs }) => {
  const page = await pageAs("owner_admin")

  await page.goto("/templates")
  const tile = page.locator('[data-slot="template-new"]').getByRole("button", { name: "New template" })
  await waitForHydration(tile)
  await tile.click()
  await page.waitForURL(/\/templates\/[0-9a-f-]+\/edit\?new=1$/)
  const templateId = new URL(page.url()).pathname.split("/")[2] as string

  await expect(page.locator('[contenteditable="true"]:focus')).toHaveCount(1)
  await page.keyboard.type("Scope of work")
  await expectSaved(admin, "document_templates", templateId, ({ blocks }) => blocks.map(({ text }) => text)).toEqual(["Scope of work"])

  const made = await admin.from("document_templates").select("title,status").eq("id", templateId).single()
  if (made.error) throw made.error
  expect(made.data).toEqual({ status: "draft", title: "Untitled template" })
})

test("words typed while offline stay on the page and are saved once the connection is back", async ({ admin, pageAs }) => {
  const page = await pageAs("owner_admin")
  await page.goto("/dashboard")
  await page.getByRole("button", { name: "New document" }).click()
  await page.waitForURL(/\/documents\/[0-9a-f-]+\/edit/)
  const documentId = new URL(page.url()).pathname.split("/")[2] as string
  await expect(page.locator('[contenteditable="true"]:focus')).toHaveCount(1)

  await page.context().setOffline(true)
  await expect(page.getByText("You're offline")).toBeVisible()
  await page.keyboard.type("Written on site, no signal")
  await expect(page.getByText("Written on site, no signal")).toBeVisible()
  // Longer than every retry (1, 3, 8, 15 s): saving must still catch up on reconnect.
  await page.waitForTimeout(20_000)

  await page.context().setOffline(false)
  await expect(page.getByText("You're offline")).toBeHidden()
  await expectSaved(admin, "documents", documentId, ({ blocks }) => blocks.map(({ text }) => text)).toEqual(["Written on site, no signal"])
})
