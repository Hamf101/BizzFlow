import type { Locator, Page } from "@playwright/test"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedFolder } from "../support/seed"

// Holds a finger on the target until `until` shows, then lifts it.
async function pressAndHold(page: Page, target: Locator, until: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error("The item to press is not on screen.")

  const touchPoints = [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }]
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Input.dispatchTouchEvent", { touchPoints, type: "touchStart" })
  await expect(until).toBeVisible()
  await cdp.send("Input.dispatchTouchEvent", { touchPoints: [], type: "touchEnd" })
}

test("a phone selects by press and hold, ticks with taps, and acts from the bar", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const owner = tenant.users.owner_admin
  const parent = await seedFolder(admin, tenant.organizationId, owner.id, uniqueName("Phone holds"))

  // Two rows of tiles, so another item sits under the finger if the list moves.
  const names = ["Held A", "Held B", "Held C", "Held D", "Held E", "Held F"]
  for (const name of names) await seedFolder(admin, tenant.organizationId, owner.id, name, parent)

  const page = await pageAs("owner_admin")
  const tile = (name: string) =>
    page
      .locator('[data-slot="file-tile"]')
      .filter({ has: page.getByRole("link", { exact: true, name }) })
  const bar = page.getByRole("group", { name: "Selection" })
  const oneSelected = bar.getByText("1 selected", { exact: true })

  await page.goto(`/documents?folderId=${parent}`)
  await waitForHydration(tile(names[0]))

  // Press and hold selects instead of opening a menu, and the list stays
  // still under the finger, so the release cannot land on another item.
  await tile(names[0]).scrollIntoViewIfNeeded()
  // Measured at its centre: the pressed tile shrinks a little about it.
  const middle = async () => {
    const box = await tile(names[0]).boundingBox()
    return box && box.y + box.height / 2
  }
  const before = await middle()
  await pressAndHold(page, tile(names[0]), oneSelected)
  expect(await middle()).toBeCloseTo(before ?? Number.NaN, 0)
  await expect(page.getByRole("menu")).toHaveCount(0)
  await expect(bar).toBeVisible()

  // Taps now tick items instead of opening them.
  await tile(names[1]).getByRole("link", { exact: true, name: names[1] }).tap()
  await expect(bar.getByText("2 selected", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`folderId=${parent}$`))

  await bar.getByRole("button", { name: "Archive 2 items" }).tap()
  await expect(page.getByText("2 items archived")).toBeVisible()
  await expect(bar).toBeHidden()
  await expect(tile(names[0])).toHaveCount(0)
  await page.getByRole("button", { name: "Undo" }).tap()
  await expect(tile(names[0])).toBeVisible()
  await expect(tile(names[1])).toBeVisible()

  // The selection waits while the member looks elsewhere, and the phone is
  // still ticking on the way back: the next tap chooses rather than opens.
  await pressAndHold(page, tile(names[2]), oneSelected)
  await page
    .getByRole("navigation", { name: "Folder path" })
    .getByRole("link", { exact: true, name: "Files" })
    .tap()
  await expect(page).toHaveURL(/\/documents$/)
  await page.goBack()
  await expect(oneSelected).toBeVisible()
  await tile(names[3]).getByRole("link", { exact: true, name: names[3] }).tap()
  await expect(bar.getByText("2 selected", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`folderId=${parent}$`))

  // The bar's cross stops selecting, and leaves nothing to come back to.
  await bar.getByRole("button", { name: "Clear selection" }).tap()
  await expect(bar).toBeHidden()
})
