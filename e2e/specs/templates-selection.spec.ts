import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"

test("selects templates with modifier clicks, archives, files and copies them together, and undoes", async ({
  admin,
  pageAs,
  tenant,
}) => {
  // One prefix narrows the shared tenant's library to this run's templates.
  const prefix = uniqueName("Bulk")
  const names = [`${prefix} A`, `${prefix} B`]
  await seedTemplate(admin, tenant.organizationId, names[0], "published")
  await seedTemplate(admin, tenant.organizationId, names[1], "draft")

  const page = await pageAs("owner_admin")
  const card = (name: string) => page.locator('[data-slot="template-card"]').filter({ hasText: name })
  const bar = page.getByRole("group", { name: "Selection" })
  const selectBoth = async () => {
    for (const name of names) {
      await card(name).getByRole("link", { name }).click({ modifiers: ["ControlOrMeta"] })
    }
    await expect(bar).toContainText("2 selected")
  }

  await page.goto(`/templates?q=${encodeURIComponent(prefix)}`)
  await waitForHydration(card(names[0]))

  // A modified click selects instead of opening.
  await selectBoth()
  await expect(page).toHaveURL(/\/templates\?/)

  // Archive both, then take it back.
  await bar.getByRole("button", { name: "Archive 2 templates" }).click()
  await expect(page.getByText("2 templates archived")).toBeVisible()
  await expect(bar).toBeHidden()
  for (const name of names) {
    await expect(card(name).locator('[data-slot="template-status"]')).toHaveText("Archived")
  }
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(page.getByText("Undone")).toBeVisible()
  await expect(card(names[0]).locator('[data-slot="template-status"]')).toHaveText("Published")
  await expect(card(names[1]).locator('[data-slot="template-status"]')).toHaveText("Draft")

  // File both under a category, then take it back.
  const category = uniqueName("Cat")
  await selectBoth()
  await bar.getByRole("button", { name: "Set the category of 2 templates" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Category").fill(category)
  await dialog.getByRole("button", { name: "Set category" }).click()
  await expect(page.getByText("2 templates filed")).toBeVisible()
  for (const name of names) {
    await expect(card(name).locator('[data-slot="template-detail"]')).toContainText(category)
  }
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(page.getByText("Undone")).toBeVisible()
  for (const name of names) {
    await expect(card(name).locator('[data-slot="template-detail"]')).not.toContainText(category)
  }

  // Copies arrive as drafts beside the originals; a copy has nothing to undo.
  await selectBoth()
  await bar.getByRole("button", { name: "Duplicate 2 templates" }).click()
  await expect(page.getByText("2 templates duplicated")).toBeVisible()
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0)
  for (const name of names) {
    await expect(card(`${name} (Copy)`)).toHaveCount(1)
  }
})

test("an archived template can be restored from its own menu, and staff select nothing", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const title = uniqueName("Put away")
  await seedTemplate(admin, tenant.organizationId, title, "archived")

  const owner = await pageAs("owner_admin")
  const card = owner.locator('[data-slot="template-card"]').filter({ hasText: title })

  await owner.goto(`/templates?q=${encodeURIComponent(title)}`)
  await waitForHydration(card)
  await card.hover()
  await card.getByRole("button", { name: `Actions for ${title}` }).click()
  await owner.getByRole("menuitem", { name: "Restore" }).click()
  await expect(owner.getByText("1 template restored")).toBeVisible()
  await expect(card.locator('[data-slot="template-status"]')).toHaveText("Draft")

  // Staff see only published templates, with no menu and no selection.
  const publishedTitle = uniqueName("For staff")
  await seedTemplate(admin, tenant.organizationId, publishedTitle, "published")
  const staff = await pageAs("staff")
  const staffCard = staff.locator('[data-slot="template-card"]').filter({ hasText: publishedTitle })

  await staff.goto(`/templates?q=${encodeURIComponent(publishedTitle)}`)
  await waitForHydration(staffCard)
  await expect(staffCard.getByRole("button", { name: /^Actions for/ })).toHaveCount(0)
  await staffCard.click({ modifiers: ["ControlOrMeta"] })
  await expect(staff.getByRole("group", { name: "Selection" })).toHaveCount(0)
})
