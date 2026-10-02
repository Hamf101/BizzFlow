import { randomUUID } from "node:crypto"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"

test("on a phone the line in use drags by the grip beside it, and the grip's arrow keys move it", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const lines = ["Opening words.", "Payment terms.", "Visit schedule.", "Closing words."].map((text) => ({
    alignment: "left",
    id: randomUUID(),
    text,
    type: "paragraph",
  }))
  const [opening, payment, visits, closing] = lines.map(({ id }) => id) as [string, string, string, string]
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Grip"), "draft", lines)
  const page = await pageAs("owner_admin")
  const grip = (text: string) => page.locator("[data-block-id]", { hasText: text }).getByRole("button", { exact: true, name: "Move" })
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
  await page.getByText("Opening words.").tap()
  await expect(grip("Opening words.")).toBeVisible()

  // A real finger: the page must not scroll under the grip, and the line follows it.
  const from = await grip("Opening words.").boundingBox()
  const to = await page.getByText("Visit schedule.").boundingBox()
  const touch = await page.context().newCDPSession(page)
  const x = from!.x + from!.width / 2
  const point = (y: number) => ({ touchPoints: [{ x, y }] })

  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", ...point(from!.y + from!.height / 2) })
  for (let step = 1; step <= 12; step += 1) {
    const y = from!.y + from!.height / 2 + ((to!.y + to!.height - 2 - (from!.y + from!.height / 2)) * step) / 12
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", ...point(y) })
  }
  await touch.send("Input.dispatchTouchEvent", { touchPoints: [], type: "touchEnd" })
  await saved().toEqual([payment, visits, opening, closing])

  await page.getByText("Closing words.").tap()
  await grip("Closing words.").focus()
  await page.keyboard.press("ArrowUp")
  await saved().toEqual([payment, visits, closing, opening])
  await expect(page.locator('[data-slot="editor-announcement"]')).toHaveText("“Closing words.” moved to 3 of 4.")
  // The grip keeps the keys, so the next press moves it again.
  await page.keyboard.press("ArrowUp")
  await saved().toEqual([payment, closing, visits, opening])
})
