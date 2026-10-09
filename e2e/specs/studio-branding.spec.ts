import { expect, expectSaved, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"

test("saves the exact brand colors picked, and prints the page with them", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Brand"))
  const page = await pageAs("owner_admin")
  await page.goto(`/templates/${template.id}/edit`)
  const brand = page.getByRole("button", { name: "Brand", exact: true })
  await waitForHydration(brand)
  await brand.click()

  for (const [name, color] of [["Primary", "#ffffff"], ["Accent", "#eeeeee"]]) {
    const swatch = page.getByRole("button", { name, exact: true })
    await swatch.click()
    await page.getByRole("dialog", { name }).getByLabel("Hex code").fill(color)
    // Pressing the swatch again closes its picker.
    await swatch.click()
  }

  // Any colour saves as picked, even one that is hard to read on paper.
  await expectSaved(admin, "document_templates", template.id, ({ branding }) => branding).toMatchObject({
    primaryColor: "#ffffff",
    accentColor: "#eeeeee",
  })

  await page.reload()
  const pages = page.locator('[data-slot="editor-pages"]')
  await waitForHydration(pages)
  // The page draws each colour from exactly the one picked, flipped for dark mode as light and dark flip.
  expect(await pages.evaluate((element) => ({
    primary: (element as HTMLElement).style.getPropertyValue("--doc-primary"),
    accent: (element as HTMLElement).style.getPropertyValue("--doc-accent"),
  }))).toEqual({ primary: expect.stringContaining("from #ffffff "), accent: expect.stringContaining("from #eeeeee ") })
})

test("duplicates fields and renames one in its settings on the page, with unique saved field keys", async ({
  admin, pageAs, tenant,
}) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Duplicate"))
  const page = await pageAs("owner_admin")
  await page.goto(`/templates/${template.id}/edit`)
  const textFields = page.locator('[data-block-type="text_field"]')
  const toolbar = page.getByRole("toolbar", { name: "Block" })
  await waitForHydration(textFields.first())

  await textFields.first().click({ position: { x: 4, y: 4 } })
  await toolbar.getByRole("button", { name: "Duplicate", exact: true }).click()
  await expect(textFields).toHaveCount(2)

  // The copy is selected, so its settings rename it, and then it is copied once more.
  await toolbar.getByRole("button", { name: "Field settings", exact: true }).click()
  await page.getByLabel("Label", { exact: true }).fill("Copied reference")
  await page.keyboard.press("Escape")
  await toolbar.getByRole("button", { name: "Duplicate", exact: true }).click()
  await expect(textFields).toHaveCount(3)

  await expectSaved(admin, "document_templates", template.id, ({ blocks }) =>
    blocks.filter(({ type }) => type === "text_field").map(({ fieldKey, label }) => ({ fieldKey, label }))
  ).toEqual([
    { fieldKey: "client_reference", label: "Client reference" },
    { fieldKey: "client_reference_2", label: "Copied reference" },
    { fieldKey: "client_reference_2_2", label: "Copied reference" },
  ])
})
