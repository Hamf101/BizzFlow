import { randomUUID } from "node:crypto"

import type { Locator, Page } from "@playwright/test"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"

// A press in a block, held first when it is words, then pulled to just
// inside the top or bottom of another block, and let go.
async function drag(page: Page, from: Locator, to: Locator, edge: "bottom" | "top", hold = 0): Promise<void> {
  const start = await from.boundingBox()
  const end = await to.boundingBox()

  if (!start || !end) {
    throw new Error("Both blocks must be on screen to drag between them.")
  }

  await page.mouse.move(start.x + 20, start.y + start.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(hold)
  await page.mouse.move(start.x + 22, start.y + start.height / 2 + 6, { steps: 2 })
  await page.mouse.move(end.x + 22, edge === "top" ? end.y + 2 : end.y + end.height - 2, { steps: 12 })
  await page.mouse.up()
}

test("blocks drag to new places and stay there, but a field never goes above the checkbox it depends on", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const account = { checkedByDefault: false, fieldKey: "has_account", helpText: null, id: randomUUID(), label: "Has an account", required: false, type: "checkbox_field" }
  const terms = { alignment: "left", id: randomUUID(), text: "Pay monthly by bank transfer.", type: "paragraph" }
  const number = {
    fieldKey: "account_number",
    helpText: null,
    id: randomUUID(),
    label: "Account number",
    multiline: false,
    placeholder: null,
    required: false,
    type: "text_field",
    visibleWhen: { operator: "equals", sourceBlockId: account.id, value: true },
  }
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Reorder"), "draft", [account, terms, number])
  const page = await pageAs("owner_admin")
  const block = (id: string): Locator => page.locator(`[data-block-id="${id}"]`)
  const saved = () =>
    expect.poll(
      async () => {
        const { data, error } = await admin.from("document_templates").select("content").eq("id", template.id).single()
        if (error) throw error
        return data.content.blocks.map(({ id }: { id: string }) => id)
      },
      { timeout: 15_000 }
    )

  await page.goto(`/templates/${template.id}/edit`)
  await waitForHydration(page.getByRole("textbox", { name: "Title" }))

  // A field drags as soon as it is pulled.
  await drag(page, block(account.id), block(terms.id), "bottom")
  await saved().toEqual([terms.id, account.id, number.id])
  await expect(page.locator('[data-slot="editor-announcement"]')).toHaveText("Has an account moved to 2 of 3.")

  // Above the paragraph, the account number would come before the checkbox that shows it.
  // Pulled by its label: a press in its answer box is typing, not a drag.
  await drag(page, block(number.id).getByText("Account number", { exact: true }), block(terms.id), "top")
  await expect(page.getByText(/^This move would place 1 conditional field before the checkbox/)).toBeVisible()
  await saved().toEqual([terms.id, account.id, number.id])

  // Words held a moment lift the whole line rather than selecting them.
  await drag(page, page.getByText("Pay monthly by bank transfer."), block(number.id), "bottom", 500)
  await saved().toEqual([account.id, number.id, terms.id])
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("")

  await page.reload()
  await waitForHydration(page.getByRole("textbox", { name: "Title" }))
  await expect(page.locator("[data-block-id]")).toHaveCount(3)
  expect(await page.locator("[data-block-id]").evaluateAll((blocks) => blocks.map((element) => element.getAttribute("data-block-id")))).toEqual([
    account.id,
    number.id,
    terms.id,
  ])
})
