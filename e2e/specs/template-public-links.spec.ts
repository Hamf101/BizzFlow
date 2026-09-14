import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"

test("keeps a template's actions behind its card menu and its public links on their own page", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const title = uniqueName("Shared form")
  const template = await seedTemplate(admin, tenant.organizationId, title, "published")
  const libraryPath = `/templates?q=${encodeURIComponent(title)}`
  const linksPath = `/templates/${template.id}/links`
  const page = await pageAs("owner_admin")
  const actions = page.getByRole("button", { name: `Actions for ${title}` })
  const path = (): string => new URL(page.url()).pathname

  await page.goto(libraryPath)
  await waitForHydration(actions)
  await actions.click()
  await page.getByRole("menuitem", { name: "Public links" }).click()
  await expect.poll(path).toBe(linksPath)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title)

  // A new link appears here, ready to copy, and is turned off from here too.
  const newLink = page.getByRole("button", { name: "New link" })
  await waitForHydration(newLink)
  await newLink.click()
  await page.getByRole("button", { name: "Generate link" }).click()
  await expect(page.getByText("Public form link created")).toBeVisible()
  expect(path()).toBe(linksPath)
  await expect(page.getByText(/^\/forms\//)).toHaveCount(1)
  await expect(page.getByText("active", { exact: true })).toBeVisible()

  const disable = page.getByRole("button", { name: "Disable" })
  await waitForHydration(disable)
  await disable.click()
  await expect(page.getByText("Public form link disabled")).toBeVisible()
  expect(path()).toBe(linksPath)
  await expect(page.getByText("disabled", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Disable" })).toHaveCount(0)

  // Duplicating opens the copy in the editor.
  await page.goto(libraryPath)
  await waitForHydration(actions)
  await actions.click()
  await page.getByRole("menuitem", { name: "Duplicate" }).click()
  await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}\/edit/)
  expect(page.url()).not.toContain(template.id)
  await expect(page.getByText("Template duplicated")).toBeVisible()

  // Only a published template takes responses through a link, so a draft's
  // public links page sends its visitor back to the library.
  const draft = await seedTemplate(admin, tenant.organizationId, uniqueName("Draft form"))

  await page.goto(`/templates/${draft.id}/links`)
  await expect.poll(path).toBe("/templates")
  await expect(page.getByText("This item changed")).toBeVisible()

  // People who cannot manage templates get no card menu and cannot open the
  // public links page.
  const staffPage = await pageAs("staff")

  await staffPage.goto(libraryPath)
  await expect(staffPage.locator('[data-slot="template-card"]').first()).toBeVisible()
  await expect(
    staffPage.getByRole("button", { name: `Actions for ${title}` })
  ).toHaveCount(0)
  await staffPage.goto(linksPath)
  await expect.poll(() => new URL(staffPage.url()).pathname).toBe("/templates")
  await expect(
    staffPage.getByText("You do not have permission for that action")
  ).toBeVisible()
})
