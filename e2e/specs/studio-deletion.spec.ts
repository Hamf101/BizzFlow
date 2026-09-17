import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"

test("deletes a selected element with Undo, and the draft saves what is left by itself", async ({
  admin,
  pageAs,
  tenant,
}, testInfo) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Deletion"))
  const page = await pageAs("owner_admin")
  if (testInfo.project.use.viewport) {
    await page.setViewportSize(testInfo.project.use.viewport)
  }
  await page.goto(`/templates/${template.id}/edit`)

  const textField = page.locator('[data-block-type="text_field"]')
  const savedKeys = async (): Promise<string[]> => {
    const { data, error } = await admin
      .from("document_templates")
      .select("content")
      .eq("id", template.id)
      .eq("org_id", tenant.organizationId)
      .single()
    if (error) throw error
    return data.content.blocks
      .filter((block: { type: string }) => block.type === "text_field")
      .map((block: { fieldKey: string }) => block.fieldKey)
  }

  await expect(textField).toHaveCount(1)
  await waitForHydration(textField)

  // Clicking an element selects it; Delete takes it away and Undo brings it back.
  await textField.click({ position: { x: 4, y: 4 } })
  await page.keyboard.press("Delete")
  await expect(textField).toHaveCount(0)
  await page.locator("[data-sonner-toast]").getByRole("button", { name: "Undo", exact: true }).click()
  await expect(textField).toHaveCount(1)

  await textField.click({ position: { x: 4, y: 4 } })
  await page.getByRole("toolbar", { name: "Block" }).getByRole("button", { name: "Delete", exact: true }).click()
  await expect(textField).toHaveCount(0)
  await expect.poll(savedKeys, { timeout: 15_000 }).toEqual([])
})
