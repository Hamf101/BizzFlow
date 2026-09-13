import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"

test("asks before deleting an element, restores it with Undo, and saves either outcome", async ({
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

  const textField = page.getByRole("button", { name: "Edit text field", exact: true })
  const confirmation = page.getByRole("dialog", { name: /Delete this/ })
  const saved = async (): Promise<{ revision: number; textFieldKeys: string[] }> => {
    const { data, error } = await admin
      .from("document_templates")
      .select("revision,content")
      .eq("id", template.id)
      .eq("org_id", tenant.organizationId)
      .single()
    if (error) throw error
    return {
      revision: data.revision,
      textFieldKeys: data.content.blocks
        .filter((block: { type: string }) => block.type === "text_field")
        .map((block: { fieldKey: string }) => block.fieldKey),
    }
  }
  const saveDraft = async (): Promise<void> => {
    await page.getByRole("button", { name: "Save draft", exact: true }).click()
    // Saving redirects back to the editor; wait for the announced outcome so
    // the next step acts on the reloaded editor, not the page being replaced.
    await expect(page.getByRole("status").filter({ hasText: "Changes saved" })).toBeVisible()
  }
  const requestDeletion = async (): Promise<void> => {
    await textField.click()
    await page.getByRole("button", { name: "Close inspector", exact: true }).click()
    await page.getByRole("button", { name: "Delete block", exact: true }).click()
    await expect(confirmation).toBeVisible()
  }

  await expect(textField).toHaveCount(1)
  await waitForHydration(textField)

  await requestDeletion()
  await confirmation.getByRole("button", { name: "Keep element", exact: true }).click()
  await expect(confirmation).toBeHidden()
  await expect(textField).toHaveCount(1)

  await page.getByRole("button", { name: "Delete block", exact: true }).click()
  await confirmation.getByRole("button", { name: "Delete element", exact: true }).click()
  await expect(textField).toHaveCount(0)

  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(textField).toHaveCount(1)

  // Undo returned the draft to exactly the saved state: saving reports success
  // and writes nothing, so the revision does not move.
  await saveDraft()
  expect(await saved()).toEqual({ revision: 1, textFieldKeys: ["client_reference"] })

  await requestDeletion()
  await confirmation.getByRole("button", { name: "Delete element", exact: true }).click()
  await expect(textField).toHaveCount(0)
  await page.getByRole("button", { name: "Save draft", exact: true }).click()
  await expect.poll(saved).toEqual({ revision: 2, textFieldKeys: [] })
})
