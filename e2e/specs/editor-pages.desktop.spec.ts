import { randomUUID } from "node:crypto"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"

const sentence = "The provider cleans every office on the agreed day and reports anything broken the same afternoon. "

test("writing longer than a page carries on onto new pages instead of running past one", async ({ admin, pageAs, tenant }) => {
  // Each block alone is taller than a page, as an older template can be.
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Long pages"), "draft", [
    { alignment: "left", id: randomUUID(), text: sentence.repeat(60).trim(), type: "paragraph" },
    { id: randomUUID(), items: Array.from({ length: 70 }, (_, index) => `Visit ${index + 1}`), type: "bullet_list" },
    {
      headers: ["Service", "Price"],
      id: randomUUID(),
      rows: Array.from({ length: 70 }, (_, index) => [`Deep clean ${index + 1}`, "$40"]),
      type: "table",
    },
  ])
  const page = await pageAs("owner_admin")

  await page.goto(`/templates/${template.id}/edit`)
  await waitForHydration(page.locator('[data-page="1"]'))

  // Every line, list item and table row sits on one page, above its bottom margin.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sheets = [...document.querySelectorAll<HTMLElement>("[data-page]")]
        const flow = document.querySelector<HTMLElement>('[data-slot="page-flow"]')
        const first = sheets[0]

        if (!flow || !first) {
          return -1
        }

        const scale = first.getBoundingClientRect().height / first.offsetHeight
        const margin = parseFloat(getComputedStyle(flow).paddingLeft) * scale
        const pages = sheets.map((sheet) => sheet.getBoundingClientRect())
        const rows = [
          ...[...flow.querySelectorAll("li[data-caret-key], tbody tr:not([aria-hidden])")].map((row) => row.getBoundingClientRect()),
          ...[...flow.querySelectorAll("p[data-caret-key]")].flatMap((paragraph) => {
            const range = document.createRange()
            range.selectNodeContents(paragraph)
            return [...range.getClientRects()]
          }),
        ]

        return rows.filter((row) => !pages.some((sheet) => row.top >= sheet.top && row.bottom <= sheet.bottom - margin + 1)).length
      })
    )
    .toBe(0)
  expect(await page.locator("[data-page]").count()).toBeGreaterThanOrEqual(4)
})
