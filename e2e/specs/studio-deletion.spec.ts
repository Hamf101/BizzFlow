import { expect, expectSaved, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"

test("deletes a selected element with Undo, and the draft saves what is left by itself", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Deletion"))
  const page = await pageAs("owner_admin")
  await page.goto(`/templates/${template.id}/edit`)

  const textField = page.locator('[data-block-type="text_field"]')
  await expect(textField).toHaveCount(1)
  await waitForHydration(textField)

  // Clicking an element selects it; Delete takes it away and Undo brings it back.
  await textField.click({ position: { x: 4, y: 4 } })
  // The selected element takes the keyboard a render after the click.
  await expect(textField).toBeFocused()
  await page.keyboard.press("Delete")
  await expect(textField).toHaveCount(0)
  await page.locator("[data-sonner-toast]").getByRole("button", { name: "Undo", exact: true }).click()
  await expect(textField).toHaveCount(1)

  await textField.click({ position: { x: 4, y: 4 } })
  await page.getByRole("toolbar", { name: "Block" }).getByRole("button", { name: "Delete", exact: true }).click()
  await expect(textField).toHaveCount(0)
  await expectSaved(admin, "document_templates", template.id, ({ blocks }) =>
    blocks.filter(({ type }) => type === "text_field").map(({ fieldKey }) => fieldKey)
  ).toEqual([])
})
