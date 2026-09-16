import type { Browser, Locator, Page, TestInfo } from "@playwright/test"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { authStatePath } from "../support/paths"
import { retryConcurrentChange } from "../support/retry"

// `pageAs` opens a bare desktop context; press and hold needs the phone's own
// viewport and touch input.
async function openAsOwner(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const device = testInfo.project.use
  const context = await browser.newContext({
    baseURL: device.baseURL ?? process.env.NEXT_PUBLIC_APP_URL,
    deviceScaleFactor: device.deviceScaleFactor,
    hasTouch: device.hasTouch,
    isMobile: device.isMobile,
    storageState: authStatePath("owner_admin"),
    userAgent: device.userAgent,
    viewport: device.viewport,
  })
  return context.newPage()
}

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
  browser,
  tenant,
}, testInfo) => {
  const owner = tenant.users.owner_admin
  const { data: parent, error: parentError } = await retryConcurrentChange(() =>
    admin
      .from("folders")
      .insert({
        created_by: owner.id,
        name: uniqueName("Phone holds"),
        org_id: tenant.organizationId,
        updated_by: owner.id,
      })
      .select("id")
      .single()
  )
  if (parentError) throw parentError

  // Two rows of tiles, so another item sits under the finger if the list moves.
  const names = ["Held A", "Held B", "Held C", "Held D", "Held E", "Held F"]
  for (const name of names) {
    const { error } = await retryConcurrentChange(() =>
      admin.from("folders").insert({
        created_by: owner.id,
        name,
        org_id: tenant.organizationId,
        parent_folder_id: parent.id,
        updated_by: owner.id,
      })
    )
    if (error) throw error
  }

  const page = await openAsOwner(browser, testInfo)

  try {
    const tile = (name: string) =>
      page
        .locator('[data-slot="file-tile"]')
        .filter({ has: page.getByRole("link", { exact: true, name }) })
    const bar = page.getByRole("navigation", { name: "Selection actions" })
    const oneSelected = page.getByText("1 selected", { exact: true })

    await page.goto(`/documents?folderId=${parent.id}`)
    await waitForHydration(tile(names[0]))

    // Press and hold selects instead of opening a menu, and the list stays
    // still under the finger, so the release cannot land on another item.
    await tile(names[0]).scrollIntoViewIfNeeded()
    const before = await tile(names[0]).boundingBox()
    await pressAndHold(page, tile(names[0]), oneSelected)
    expect((await tile(names[0]).boundingBox())?.y).toBe(before?.y)
    await expect(page.getByRole("menu")).toHaveCount(0)
    await expect(bar).toBeVisible()

    // Taps now tick items instead of opening them.
    await tile(names[1]).getByRole("link", { exact: true, name: names[1] }).tap()
    await expect(page.getByText("2 selected", { exact: true })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`folderId=${parent.id}$`))

    await bar.getByRole("button", { name: "Archive 2 items" }).tap()
    await expect(page.getByText("2 items archived")).toBeVisible()
    await expect(bar).toBeHidden()
    await expect(tile(names[0])).toHaveCount(0)
    await page.getByRole("button", { name: "Undo" }).tap()
    await expect(tile(names[0])).toBeVisible()
    await expect(tile(names[1])).toBeVisible()

    // Done stops selecting and gives the tabs back.
    await pressAndHold(page, tile(names[2]), oneSelected)
    await page.getByRole("button", { name: "Done" }).tap()
    await expect(bar).toBeHidden()
    await expect(oneSelected).toBeHidden()
  } finally {
    await page.context().close()
  }
})
