import { randomUUID } from "node:crypto"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"

test("formats the chosen words from the toolbar and adds a table from Insert's grid, then keeps both", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Formatting"), "draft", [
    { alignment: "left", id: randomUUID(), text: "Pay the invoice within thirty days.", type: "paragraph" },
  ])
  const page = await pageAs("owner_admin")

  await page.goto(`/templates/${template.id}/edit`)
  // The line itself is drawn by the editor library rather than React, so the title shows hydration.
  await waitForHydration(page.getByRole("textbox", { name: "Title" }))
  await page.getByRole("textbox", { name: "Text" }).click()

  // "invoice": eight characters in, seven long.
  await page.keyboard.press("Home")
  for (let step = 0; step < 8; step += 1) await page.keyboard.press("ArrowRight")
  for (let step = 0; step < 7; step += 1) await page.keyboard.press("Shift+ArrowRight")
  await page.getByRole("button", { name: "Bold" }).click()
  await page.getByRole("button", { name: "Text color" }).click()
  await page.getByRole("button", { name: "Dark red", exact: true }).click()
  await expect(page.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true")

  await page.getByRole("button", { name: "Insert" }).click()
  await page.getByRole("menuitem", { name: "Table" }).click()
  await page.getByRole("menuitem", { name: "3 by 2 table" }).click()

  await expect
    .poll(
      async () => {
        const { data, error } = await admin.from("document_templates").select("content").eq("id", template.id).single()
        if (error) throw error
        return data.content.blocks.map(({ headers, rows, runs, type }: Record<string, unknown>) => ({ headers, rows, runs, type }))
      },
      { timeout: 15_000 }
    )
    .toEqual([
      {
        runs: [{ text: "Pay the " }, { bold: true, color: "#990000", text: "invoice" }, { text: " within thirty days." }],
        type: "paragraph",
      },
      { headers: ["Column 1", "Column 2", "Column 3"], rows: [["", "", ""]], type: "table" },
    ])
})
