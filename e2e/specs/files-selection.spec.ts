import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { retryConcurrentChange } from "../support/retry"

test("selects files with modifier clicks, archives them together, and undoes it", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const owner = tenant.users.owner_admin
  const names = [uniqueName("Selected A"), uniqueName("Selected B")]

  for (const name of names) {
    const { error } = await retryConcurrentChange(() =>
      admin.from("folders").insert({
        created_by: owner.id,
        name,
        org_id: tenant.organizationId,
        updated_by: owner.id,
      })
    )
    if (error) throw error
  }

  const page = await pageAs("owner_admin")
  const tile = (name: string) =>
    page
      .locator('[data-slot="file-tile"]')
      .filter({ has: page.getByRole("link", { exact: true, name }) })

  await page.goto("/documents")
  await waitForHydration(tile(names[0]))

  // A modified click selects instead of opening, as in Finder.
  for (const name of names) {
    await tile(name)
      .getByRole("link", { exact: true, name })
      .click({ modifiers: ["ControlOrMeta"] })
  }
  await expect(page).toHaveURL(/\/documents$/)
  // The selection floats in a bar with its count and the changes it allows.
  const bar = page.getByRole("group", { name: "Selection" })
  await expect(bar).toContainText("2 selected")

  // Either selected item's menu acts on both, and closing it keeps them.
  const actions = tile(names[1]).getByRole("button", { name: `Actions for ${names[1]}` })
  await tile(names[1]).hover()
  await actions.click()
  await expect(page.getByRole("menuitem", { name: "Archive 2 items" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toHaveCount(0)
  await expect(bar).toContainText("2 selected")
  await bar.getByRole("button", { name: "Archive 2 items" }).click()
  await expect(page.getByText("2 items archived")).toBeVisible()
  await expect(bar).toBeHidden()
  await expect(tile(names[0])).toHaveCount(0)
  await expect(tile(names[1])).toHaveCount(0)

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(page.getByText("Undone")).toBeVisible()
  await expect(tile(names[0])).toBeVisible()
  await expect(tile(names[1])).toBeVisible()
})

test("right-click acts on the selection, or selects the item it lands on", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const owner = tenant.users.owner_admin
  const names = [uniqueName("Clicked A"), uniqueName("Clicked B"), uniqueName("Clicked C")]

  for (const name of names) {
    const { error } = await retryConcurrentChange(() =>
      admin.from("folders").insert({
        created_by: owner.id,
        name,
        org_id: tenant.organizationId,
        updated_by: owner.id,
      })
    )
    if (error) throw error
  }

  const page = await pageAs("owner_admin")
  const tile = (name: string) =>
    page
      .locator('[data-slot="file-tile"]')
      .filter({ has: page.getByRole("link", { exact: true, name }) })
  const link = (name: string) => tile(name).getByRole("link", { exact: true, name })
  const bar = page.getByRole("group", { name: "Selection" })

  await page.goto("/documents")
  await waitForHydration(tile(names[0]))
  await link(names[0]).click({ modifiers: ["ControlOrMeta"] })
  await link(names[1]).click({ modifiers: ["ControlOrMeta"] })

  // A selected item's right-click menu offers the whole selection's changes,
  // and closing it keeps the selection.
  await link(names[1]).click({ button: "right" })
  await expect(page.getByRole("menuitem", { name: "Move 2 items to Trash" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toHaveCount(0)
  await expect(bar).toContainText("2 selected")

  await link(names[0]).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Move 2 items to Trash" }).click()
  await expect(page.getByText("2 items moved to Trash")).toBeVisible()
  await expect(tile(names[0])).toHaveCount(0)
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(tile(names[0])).toBeVisible()
  await expect(tile(names[1])).toBeVisible()

  // Outside the selection, a right-click selects only the item it lands on.
  await link(names[2]).click({ button: "right" })
  await expect(bar).toContainText("1 selected")
  await page.getByRole("menuitem", { exact: true, name: "Archive" }).click()
  await expect(tile(names[2])).toHaveCount(0)
  // An item that leaves the folder leaves the selection with it.
  await expect(bar).toBeHidden()
})

test("keeps a selection through a search, and starts fresh in another view", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const owner = tenant.users.owner_admin
  const shared = uniqueName("Kept")
  const names = [`${shared} kept here`, uniqueName("Kept elsewhere")]

  for (const name of names) {
    const { error } = await retryConcurrentChange(() =>
      admin.from("folders").insert({
        created_by: owner.id,
        name,
        org_id: tenant.organizationId,
        updated_by: owner.id,
      })
    )
    if (error) throw error
  }

  const page = await pageAs("owner_admin")
  const tile = (name: string) =>
    page
      .locator('[data-slot="file-tile"]')
      .filter({ has: page.getByRole("link", { exact: true, name }) })
  const bar = page.getByRole("group", { name: "Selection" })

  await page.goto("/documents")
  await waitForHydration(tile(names[0]))

  for (const name of names) {
    await tile(name)
      .getByRole("link", { exact: true, name })
      .click({ modifiers: ["ControlOrMeta"] })
  }
  await expect(bar).toContainText("2 selected")

  // The search narrows what is shown; both stay chosen.
  await page.getByLabel("Search files").fill(shared)
  await page.getByLabel("Search files").press("Enter")
  await expect(page).toHaveURL(/[?&]q=/)
  await expect(tile(names[1])).toHaveCount(0)
  await expect(bar).toContainText("2 selected")

  // Another lifecycle view is another list.
  await page.goto("/documents?view=archived")
  await expect(bar).toBeHidden()
})
