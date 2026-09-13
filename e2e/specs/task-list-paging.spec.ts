import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"

const PAGE_SIZE = 25
const SEEDED_TASKS = 55

test("searches, filters, sorts, and pages tasks through shareable URLs", async ({
  admin,
  pageAs,
  tenant,
}, testInfo) => {
  // Each device project searches its own prefix, so every count is exact even
  // though both projects run against the shared tenant at the same time.
  const prefix = uniqueName("Paging")
  const owner = tenant.users.owner_admin
  const { error } = await admin.from("tasks").insert(
    Array.from({ length: SEEDED_TASKS }, (_, index) => ({
      created_by: owner.id,
      due_at: new Date(Date.UTC(2031, 0, 1, index)).toISOString(),
      org_id: tenant.organizationId,
      title: `${prefix} ${String(index + 1).padStart(2, "0")}`,
      updated_by: owner.id,
    }))
  )
  if (error) throw error

  const page = await pageAs("owner_admin")
  if (testInfo.project.use.viewport) {
    await page.setViewportSize(testInfo.project.use.viewport)
  }
  const pagination = page.getByRole("navigation", { name: "Pagination" })
  const firstTitle = page.locator('[data-slot="task-row"] a').first()
  const param = (name: string): string | null =>
    new URL(page.url()).searchParams.get(name)

  try {
    await page.goto(`/tasks?size=${PAGE_SIZE}`)

    // Searching keeps the page size and starts on page one.
    await page.getByRole("searchbox", { name: "Search tasks" }).fill(prefix)
    await page.getByRole("searchbox", { name: "Search tasks" }).press("Enter")
    await expect.poll(() => param("q")).toBe(prefix)
    expect(param("size")).toBe("25")
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
      "Tasks 55 tasks"
    )
    await expect(pagination).toHaveText("1–25 of 55")
    await expect(pagination.getByRole("link", { name: "Previous page" })).toHaveCount(0)

    await pagination.getByRole("link", { name: "Next page" }).click()
    await expect(pagination).toHaveText("26–50 of 55")
    expect(param("page")).toBe("2")

    // A status pill keeps the search and page size and restarts the paging.
    await page
      .getByRole("navigation", { name: "Filter tasks by status" })
      .getByRole("link", { name: "Open" })
      .click()
    await expect.poll(() => param("status")).toBe("open")
    expect([param("q"), param("size"), param("page")]).toEqual([prefix, "25", null])
    await expect(pagination).toHaveText("1–25 of 55")

    // Order lives behind the view menu, which marks itself once changed.
    const viewOptions = page.getByRole("button", { name: /^View options/ })
    await waitForHydration(viewOptions)
    await viewOptions.click()
    await page.getByRole("menuitem", { name: "Title, Z to A" }).click()
    await expect.poll(() => param("sort")).toBe("-title")
    await expect(viewOptions).toHaveAccessibleName("View options (changed)")
    await expect(firstTitle).toHaveText(`${prefix} 55`)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)

    // A stale link past the end lands on the last page that still has tasks.
    const staleLink = new URL(page.url())
    staleLink.searchParams.set("page", "9999")
    await page.goto(`${staleLink.pathname}${staleLink.search}`)
    await expect.poll(() => param("page")).toBe("3")
    await expect(pagination).toHaveText("51–55 of 55")
    await expect(firstTitle).toHaveText(`${prefix} 05`)
    await expect(pagination.getByRole("link", { name: "Next page" })).toHaveCount(0)

    // New tasks are created from a dialog, like People's invite.
    const newTask = page.getByRole("button", { name: "New task" })
    await waitForHydration(newTask)
    await newTask.click()
    const dialog = page.getByRole("dialog", { name: "New task" })
    await dialog.getByLabel("Title").fill(`${prefix} created`)
    await dialog.getByRole("button", { name: "Create task" }).click()
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}/)
    await expect(page.getByText(`${prefix} created`).first()).toBeVisible()
  } finally {
    await admin
      .from("tasks")
      .delete()
      .eq("org_id", tenant.organizationId)
      .like("title", `${prefix}%`)
  }
})
