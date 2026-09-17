import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"

test("warns about paper contrast while saving exact brand colors", async ({
  admin,
  pageAs,
  tenant,
}, testInfo) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Contrast"))
  const page = await pageAs("owner_admin")
  if (testInfo.project.use.viewport) {
    await page.setViewportSize(testInfo.project.use.viewport)
  }
  await page.goto(`/templates/${template.id}/edit`)
  const brand = page.getByRole("button", { name: "Brand", exact: true })
  await waitForHydration(brand)
  await brand.click()

  const status = page.locator("#branding-paper-contrast")
  await expect(status).toContainText("Paper contrast")
  await page.locator("#branding-primary-color").fill("#ffffff")
  await page.locator("#branding-accent-color").fill("#eeeeee")
  await expect(status).toContainText("Low paper contrast")
  await expect(status).toContainText("Primary 1.00:1")
  await expect(status).toContainText("Accent 1.16:1")
  await status.evaluate((element) => element.scrollIntoView({ block: "center" }))
  const bounds = await status.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await status.screenshot({ path: testInfo.outputPath("paper-contrast.png") })

  // Low contrast warns but never blocks: the draft saves the exact colors.
  await expect.poll(async () => {
    const { data, error } = await admin.from("document_templates")
      .select("content")
      .eq("id", template.id)
      .eq("org_id", tenant.organizationId)
      .single()
    if (error) throw error
    return data.content.branding
  }, { timeout: 15_000 }).toMatchObject({ primaryColor: "#ffffff", accentColor: "#eeeeee" })

  await page.reload()
  const preview = page.getByRole("radio", { name: "Preview", exact: true })
  await waitForHydration(preview)
  await preview.click()
  const pages = page.locator('[data-slot="editor-pages"]')
  await expect(pages).toHaveAttribute("data-document-surface", "paper")
  expect(await pages.evaluate((element) => ({
    primary: (element as HTMLElement).style.getPropertyValue("--doc-primary"),
    accent: (element as HTMLElement).style.getPropertyValue("--doc-accent"),
  }))).toEqual({ primary: "#ffffff", accent: "#eeeeee" })
})

test("duplicates fields from the toolbar and from settings with unique saved field keys", async ({
  admin, pageAs, tenant,
}, testInfo) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Duplicate"))
  const page = await pageAs("owner_admin")
  if (testInfo.project.use.viewport) {
    await page.setViewportSize(testInfo.project.use.viewport)
  }
  await page.goto(`/templates/${template.id}/edit`)
  const textFields = page.locator('[data-block-type="text_field"]')
  const toolbar = page.getByRole("toolbar", { name: "Block" })
  await waitForHydration(textFields.first())

  await textFields.first().click({ position: { x: 4, y: 4 } })
  await toolbar.getByRole("button", { name: "Duplicate", exact: true }).click()
  await expect(textFields).toHaveCount(2)

  // The copy is selected, so its settings rename it and copy it once more.
  await toolbar.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByLabel("Label", { exact: true }).fill("Copied reference")
  await page.getByRole("button", { name: "Duplicate Text field", exact: true }).click()
  await expect(textFields).toHaveCount(3)

  await expect.poll(async () => {
    const { data, error } = await admin.from("document_templates")
      .select("content").eq("id", template.id).eq("org_id", tenant.organizationId).single()
    if (error) throw error
    return data.content.blocks
      .filter((block: { type: string }) => block.type === "text_field")
      .map((block: { fieldKey: string; label: string }) => ({ fieldKey: block.fieldKey, label: block.label }))
  }, { timeout: 15_000 }).toEqual([
    { fieldKey: "client_reference", label: "Client reference" },
    { fieldKey: "client_reference_2", label: "Copied reference" },
    { fieldKey: "client_reference_2_2", label: "Copied reference" },
  ])
})
