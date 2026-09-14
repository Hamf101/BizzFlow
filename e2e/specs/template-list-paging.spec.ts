import { createBlankTemplateContent } from "@/types/template"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"

const PAGE_SIZE = 25
const PUBLISHED = 55
const DRAFTS = 5
const CATEGORIZED = 3

test("searches, filters, sorts, and pages templates through shareable URLs", async ({
  admin,
  pageAs,
  tenant,
}, testInfo) => {
  // Each device project searches its own prefix, so every count is exact even
  // though both projects run against the shared tenant at the same time. The
  // drafts share the prefix, so the status pill has to narrow the list, and
  // the first three published templates carry the prefix as their category.
  const prefix = uniqueName("Library")
  const content = createBlankTemplateContent()
  const publishedAt = new Date().toISOString()
  const seedRow = (
    title: string,
    published: boolean,
    category: string | null
  ): Record<string, unknown> => ({
    category,
    content,
    org_id: tenant.organizationId,
    published_at: published ? publishedAt : null,
    status: published ? "published" : "draft",
    title,
  })
  const { error } = await admin.from("document_templates").insert([
    ...Array.from({ length: PUBLISHED }, (_, index) =>
      seedRow(
        `${prefix} ${String(index + 1).padStart(2, "0")}`,
        true,
        index < CATEGORIZED ? prefix : null
      )
    ),
    ...Array.from({ length: DRAFTS }, (_, index) =>
      seedRow(`${prefix} draft ${index + 1}`, false, null)
    ),
  ])
  if (error) throw error

  const page = await pageAs("owner_admin")
  if (testInfo.project.use.viewport) {
    await page.setViewportSize(testInfo.project.use.viewport)
  }
  const heading = page.getByRole("heading", { level: 1 })
  const pagination = page.getByRole("navigation", { name: "Pagination" })
  const firstTitle = page
    .locator('[data-slot="template-card"] [data-slot="template-title"]')
    .first()
  const viewOptions = page.getByRole("button", { name: /^View options/ })
  const param = (name: string): string | null =>
    new URL(page.url()).searchParams.get(name)

  await page.goto(`/templates?size=${PAGE_SIZE}`)

  // Searching keeps the page size and starts on page one.
  const search = page.getByRole("searchbox", { name: "Search templates" })
  await search.fill(prefix)
  await search.press("Enter")
  await expect.poll(() => param("q")).toBe(prefix)
  expect(param("size")).toBe("25")
  await expect(heading).toHaveAccessibleName("Templates 60 templates")
  await expect(pagination).toHaveText("1–25 of 60")
  await expect(pagination.getByRole("link", { name: "Previous page" })).toHaveCount(0)

  await pagination.getByRole("link", { name: "Next page" }).click()
  await expect(pagination).toHaveText("26–50 of 60")
  expect(param("page")).toBe("2")

  // A status pill narrows the view, keeps the search and page size, and
  // restarts the paging.
  await page
    .getByRole("navigation", { name: "Filter templates by status" })
    .getByRole("link", { name: "Published" })
    .click()
  await expect.poll(() => param("status")).toBe("published")
  expect([param("q"), param("size"), param("page")]).toEqual([prefix, "25", null])
  await expect(heading).toHaveAccessibleName("Templates 55 templates")
  await expect(pagination).toHaveText("1–25 of 55")

  // Order lives behind the view menu, which marks itself once changed.
  await waitForHydration(viewOptions)
  await viewOptions.click()
  await page.getByRole("menuitem", { name: "Title, Z to A" }).click()
  await expect.poll(() => param("sort")).toBe("-title")
  await expect(viewOptions).toHaveAccessibleName("View options (changed)")
  await expect(firstTitle).toHaveText(`${prefix} 55`)
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true)

  // A stale link past the end lands on the last page that still has templates.
  const staleLink = new URL(page.url())
  staleLink.searchParams.set("page", "9999")
  await page.goto(`${staleLink.pathname}${staleLink.search}`)
  await expect.poll(() => param("page")).toBe("3")
  await expect(pagination).toHaveText("51–55 of 55")
  await expect(firstTitle).toHaveText(`${prefix} 05`)
  await expect(pagination.getByRole("link", { name: "Next page" })).toHaveCount(0)

  // So does the category, which also starts again on page one.
  await waitForHydration(viewOptions)
  await viewOptions.click()
  await page.getByRole("menuitem", { exact: true, name: prefix }).click()
  await expect.poll(() => param("category")).toBe(prefix)
  expect(param("page")).toBeNull()
  await expect(heading).toHaveAccessibleName("Templates 3 templates")
  await expect(firstTitle).toHaveText(`${prefix} 03`)
})
