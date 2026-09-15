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
  await expect(page.getByRole("heading", { level: 1 })).toContainText("2 selected")

  // Either selected item's menu acts on both.
  await tile(names[1]).hover()
  await tile(names[1]).getByRole("button", { name: `Actions for ${names[1]}` }).click()
  await page.getByRole("menuitem", { name: "Archive 2 items" }).click()
  await expect(page.getByText("2 items archived")).toBeVisible()
  await expect(tile(names[0])).toHaveCount(0)
  await expect(tile(names[1])).toHaveCount(0)

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(page.getByText("Undone")).toBeVisible()
  await expect(tile(names[0])).toBeVisible()
  await expect(tile(names[1])).toBeVisible()
})
