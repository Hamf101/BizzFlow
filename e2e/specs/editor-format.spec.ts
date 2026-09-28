import { randomUUID } from "node:crypto"

import type { Locator } from "@playwright/test"
import type { Editor } from "@tiptap/core"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"

// The words a line's editor holds as chosen: what the toolbar formats. Tiptap
// hangs the editor on its element; like `__reactProps$` in waitForHydration it
// is only waited on, so a rename fails here loudly.
function chosenWords(line: Locator): Promise<string> {
  return line.evaluate((element: Element): string => {
    const { state } = (element as HTMLElement & { editor: Editor }).editor
    return state.doc.textBetween(state.selection.from, state.selection.to)
  })
}

test("formats the chosen words from the toolbar, adds a table from Insert's grid and a column from a cell, then keeps it all", async ({
  admin,
  pageAs,
  tenant,
}, testInfo) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Formatting"), "draft", [
    { alignment: "left", id: randomUUID(), text: "Pay the invoice within thirty days.", type: "paragraph" },
  ])
  const page = await pageAs("owner_admin")

  await page.goto(`/templates/${template.id}/edit`)
  // The line itself is drawn by the editor library rather than React, so the title shows hydration.
  await waitForHydration(page.getByRole("textbox", { name: "Title" }))
  const line = page.getByRole("textbox", { name: "Text" })

  // "invoice": eight characters in, seven long. Keys straight after the click
  // have now and then not reached the editor under a full suite's load, and
  // Bold then marked a bare caret, so the choice is made until the editor holds it.
  await expect(async () => {
    await line.click()
    await page.keyboard.press("Home")
    for (let step = 0; step < 8; step += 1) await page.keyboard.press("ArrowRight")
    for (let step = 0; step < 7; step += 1) await page.keyboard.press("Shift+ArrowRight")
    expect(await chosenWords(line)).toBe("invoice")
  }).toPass({ timeout: 15_000 })
  await page.getByRole("button", { name: "Bold" }).click()
  await page.getByRole("button", { name: "Text color" }).click()
  await page.getByRole("button", { name: "Dark red", exact: true }).click()
  // The word itself: Bold shows pressed on a bare caret too.
  await expect(line.locator("strong")).toHaveText("invoice")

  // Arial is not a Google font; the menu offers the one that takes the same room.
  await page.getByRole("combobox", { name: /^Font/ }).click()
  await expect(page.getByPlaceholder(/^Search fonts/)).toBeFocused()
  await page.keyboard.type("arial")
  await expect(page.getByRole("option")).toHaveText([/^Arimo/])
  await page.keyboard.press("Enter")
  await expect(page.getByRole("combobox", { name: "Font: Arimo" })).toBeVisible()

  await page.getByRole("button", { name: "Insert" }).click()
  await page.getByRole("menuitem", { name: "Table" }).click()
  await page.getByRole("menuitem", { name: "3 by 2 table" }).click()

  // A right-click on a cell opens its menu; a phone floats a button for it while the cell is typed in.
  const cell = page.getByRole("textbox", { name: "Row 1, column 3" })
  if (testInfo.project.name === "mobile-chrome") {
    await cell.tap()
    await page.getByRole("button", { name: "Rows and columns" }).click()
  } else {
    await cell.click({ button: "right" })
  }
  await page.getByRole("menuitem", { name: "Insert column right" }).click()

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
        runs: [{ text: "Pay the " }, { bold: true, color: "#990000", font: "arimo", text: "invoice" }, { text: " within thirty days." }],
        type: "paragraph",
      },
      { headers: ["Column 1", "Column 2", "Column 3", "Column 4"], rows: [["", "", "", ""]], type: "table" },
    ])
})
