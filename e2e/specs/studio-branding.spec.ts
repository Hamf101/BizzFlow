import { expect, test, uniqueName } from "../support/fixtures"
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
  await page.getByRole("button", { name: "Brand", exact: true }).click()

  const status = page.locator("#branding-paper-contrast")
  await expect(status).toContainText("Paper contrast")
  await page.locator("#branding-primary-color").fill("#ffffff")
  await page.locator("#branding-accent-color").fill("#eeeeee")
  await expect(status).toContainText("Low paper contrast")
  await expect(status).toContainText("Primary 1.00:1")
  await expect(status).toContainText("Accent 1.16:1")
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeEnabled()
  await expect(status).toBeVisible()
  await status.scrollIntoViewIfNeeded()
  await status.evaluate((element) => element.scrollIntoView({ block: "center" }))
  const bounds = await status.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await status.screenshot({ path: testInfo.outputPath("paper-contrast.png") })

  await page.getByRole("button", { name: "Save draft", exact: true }).click()
  await expect.poll(async () => {
    const { data, error } = await admin.from("document_templates")
      .select("content")
      .eq("id", template.id)
      .eq("org_id", tenant.organizationId)
      .single()
    if (error) throw error
    return data.content.branding
  }).toMatchObject({ primaryColor: "#ffffff", accentColor: "#eeeeee" })

  await page.reload()
  await page.getByRole("radio", { name: "Preview", exact: true }).click()
  const preview = page.getByRole("article", { name: "Template preview" })
  await expect(preview).toHaveAttribute("data-document-surface", "paper")
  expect(await preview.evaluate((element) => ({
    primary: (element as HTMLElement).style.getPropertyValue("--template-primary"),
    accent: (element as HTMLElement).style.getPropertyValue("--template-accent"),
  }))).toEqual({ primary: "#ffffff", accent: "#eeeeee" })
})

test("duplicates fields through canvas and inspector with unique saved field keys", async ({
  admin, pageAs, tenant,
}, testInfo) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Duplicate"))
  const page = await pageAs("owner_admin")
  if (testInfo.project.use.viewport) {
    await page.setViewportSize(testInfo.project.use.viewport)
  }
  await page.goto(`/templates/${template.id}/edit`)
  await page.getByRole("button", { name: "Edit text field", exact: true }).click()
  await page.getByRole("button", { name: "Close inspector", exact: true }).click()
  await page.getByRole("button", { name: "Duplicate block", exact: true }).click({ timeout: 10_000 })
  await expect(page.getByRole("button", { name: "Edit text field", exact: true })).toHaveCount(2)
  await expect(page.locator('[data-template-block-id] button[aria-pressed="true"]:focus')).toHaveCount(1)
  await page.getByLabel("Label", { exact: true }).fill("Copied reference")
  await page.getByRole("button", { name: "Duplicate Text field", exact: true }).click()
  await expect(page.getByRole("button", { name: "Edit text field", exact: true })).toHaveCount(3)
  await page.getByRole("button", { name: "Save draft", exact: true }).click()

  await expect.poll(async () => {
    const { data, error } = await admin.from("document_templates")
      .select("content").eq("id", template.id).eq("org_id", tenant.organizationId).single()
    if (error) throw error
    return data.content.blocks
      .filter((block: { type: string }) => block.type === "text_field")
      .map((block: { fieldKey: string; label: string }) => ({ fieldKey: block.fieldKey, label: block.label }))
  }).toEqual([
    { fieldKey: "client_reference", label: "Client reference" },
    { fieldKey: "client_reference_2", label: "Copied reference" },
    { fieldKey: "client_reference_2_2", label: "Copied reference" },
  ])
})
