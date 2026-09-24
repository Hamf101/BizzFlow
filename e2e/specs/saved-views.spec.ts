import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"

test("saves a list's settings as a view, reopens, renames, and deletes it", async ({
  pageAs,
}) => {
  // Staff keep views too. Both device projects save views for the same member
  // at once, so each run's view is a search for its own unique name: their
  // settings never match, and neither run can take the other's view as its own.
  const page = await pageAs("staff")
  const name = uniqueName("Search view")
  const renamed = `${name} renamed`
  const query = new URLSearchParams({ q: name }).toString()
  const viewOptions = page.getByRole("button", { exact: true, name: "View options" })
  const viewItem = (label: string) =>
    page.getByRole("menuitem", { exact: true, name: label })
  // The title's menu can still be mounted while the view options open, and
  // both list the same views, so these read the options' own group.
  const savedView = (label: string) =>
    page.getByLabel("Views").getByRole("menuitem", { exact: true, name: label })

  await page.goto(`/tasks?${query}`)
  await waitForHydration(viewOptions)
  await viewOptions.click()
  await page.getByRole("menuitem", { name: "Save this view…" }).click()
  await page.getByRole("dialog").getByLabel("Name").fill(name)
  await page.getByRole("button", { name: "Save view" }).click()
  await expect(page.getByText("View saved")).toBeVisible()
  // The open view names the list.
  const heading = page.getByRole("heading", { level: 1 })
  await expect(heading).toContainText(name)

  // From the list's default settings, the title's menu leads back to the view.
  await page.goto("/tasks")
  const titleMenu = heading.getByRole("button")
  await waitForHydration(titleMenu)
  await titleMenu.click()
  await viewItem(name).click()
  await expect(page).toHaveURL(
    new RegExp(`/tasks\\?${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
  )
  await expect(heading).toContainText(name)

  await viewOptions.click()
  await expect(savedView(name)).toHaveAttribute("aria-current", "true")
  await page.getByRole("menuitem", { name: "Rename this view…" }).click()
  const nameField = page.getByRole("dialog").getByLabel("Name")
  await expect(nameField).toHaveValue(name)
  await nameField.fill(renamed)
  await page.getByRole("button", { name: "Rename view" }).click()
  await expect(page.getByText("View renamed")).toBeVisible()

  await viewOptions.click()
  await expect(savedView(renamed)).toHaveAttribute("aria-current", "true")
  await page.getByRole("menuitem", { name: "Delete this view" }).click()
  await expect(page.getByText("View deleted")).toBeVisible()
  await expect(heading).not.toContainText(renamed)

  await viewOptions.click()
  await expect(savedView(renamed)).toHaveCount(0)
  await expect(page.getByRole("menuitem", { name: "Save this view…" })).toBeVisible()
})
