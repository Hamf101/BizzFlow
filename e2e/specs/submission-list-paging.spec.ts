import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"

const PAGE_SIZE = 25
const SUBMITTED = 55
const DRAFTS = 5

test("searches, filters, sorts, pages, and exports submissions through shareable URLs", async ({
  admin,
  pageAs,
  tenant,
}, testInfo) => {
  // Each device project searches its own prefix, so every count is exact even
  // though both projects run against the shared tenant at the same time. The
  // drafts share the prefix, so the status pill has to narrow both the list
  // and the export. The seeded rows stay behind in the disposable tenant.
  const prefix = uniqueName("Queue")
  const owner = tenant.users.owner_admin
  const template = await seedTemplate(
    admin,
    tenant.organizationId,
    `${prefix} form`,
    "published"
  )
  const submittedAt = new Date().toISOString()
  const seedRow = (title: string, submitted: boolean): Record<string, unknown> => ({
    created_by: owner.id,
    org_id: tenant.organizationId,
    status: submitted ? "submitted" : "draft",
    submitted_at: submitted ? submittedAt : null,
    submitted_by: submitted ? owner.id : null,
    template_id: template.id,
    template_revision: 1,
    template_snapshot: template.content,
    title,
    updated_by: owner.id,
    values: { [template.textFieldKey]: "REF-4417" },
  })
  const { error } = await admin.from("submissions").insert([
    ...Array.from({ length: SUBMITTED }, (_, index) =>
      seedRow(`${prefix} ${String(index + 1).padStart(2, "0")}`, true)
    ),
    ...Array.from({ length: DRAFTS }, (_, index) =>
      seedRow(`${prefix} draft ${index + 1}`, false)
    ),
  ])
  if (error) throw error

  const page = await pageAs("owner_admin")
  if (testInfo.project.use.viewport) {
    await page.setViewportSize(testInfo.project.use.viewport)
  }
  const heading = page.getByRole("heading", { level: 1 })
  const pagination = page.getByRole("navigation", { name: "Pagination" })
  const firstTitle = page.locator('[data-slot="submission-row"] a').first()
  const param = (name: string): string | null =>
    new URL(page.url()).searchParams.get(name)

  await page.goto(`/submissions?size=${PAGE_SIZE}`)

  // Searching keeps the page size and starts on page one.
  const search = page.getByRole("searchbox", { name: "Search submissions" })
  await search.fill(prefix)
  await search.press("Enter")
  await expect.poll(() => param("q")).toBe(prefix)
  expect(param("size")).toBe("25")
  await expect(heading).toHaveAccessibleName("Submissions 60 submissions")
  await expect(pagination).toHaveText("1–25 of 60")
  await expect(pagination.getByRole("link", { name: "Previous page" })).toHaveCount(0)

  await pagination.getByRole("link", { name: "Next page" }).click()
  await expect(pagination).toHaveText("26–50 of 60")
  expect(param("page")).toBe("2")

  // A status pill narrows the view, keeps the search and page size, and
  // restarts the paging.
  await page
    .getByRole("navigation", { name: "Filter submissions by status" })
    .getByRole("link", { name: "Submitted" })
    .click()
  await expect.poll(() => param("status")).toBe("submitted")
  expect([param("q"), param("size"), param("page")]).toEqual([prefix, "25", null])
  await expect(heading).toHaveAccessibleName("Submissions 55 submissions")
  await expect(pagination).toHaveText("1–25 of 55")

  // Order and export live behind the view menu, which marks itself once changed.
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

  // The export carries the whole view, not the page on screen: every
  // submitted row, in the view's order, and none of the drafts.
  await viewOptions.click()
  const exportHref = await page
    .getByRole("menuitem", { name: "Download CSV" })
    .getAttribute("href")
  await page.keyboard.press("Escape")
  const exportUrl = new URL(exportHref ?? "", page.url())
  expect(exportUrl.pathname).toBe("/api/export/submissions")
  expect(
    ["status", "q", "sort", "page", "size"].map((name: string) =>
      exportUrl.searchParams.get(name)
    )
  ).toEqual(["submitted", prefix, "-title", null, null])
  const exported = await page.request.get(exportUrl.toString())
  expect(exported.status()).toBe(200)
  const lines = (await exported.text()).trim().split("\n")
  expect(lines).toHaveLength(SUBMITTED + 1)
  expect(lines[1]).toContain(`${prefix} 55`)

  // A stale link past the end lands on the last page that still has submissions.
  const staleLink = new URL(page.url())
  staleLink.searchParams.set("page", "9999")
  await page.goto(`${staleLink.pathname}${staleLink.search}`)
  await expect.poll(() => param("page")).toBe("3")
  await expect(pagination).toHaveText("51–55 of 55")
  await expect(firstTitle).toHaveText(`${prefix} 05`)
  await expect(pagination.getByRole("link", { name: "Next page" })).toHaveCount(0)
})
