import type { Page } from "@playwright/test"

import { createBlankTemplateContent } from "@/types/template"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { searchList } from "../support/search"
import { seedTemplate } from "../support/seed"

// Each device project searches its own prefix, so every count is exact even
// though both projects run against the shared tenant at the same time. Drafts
// share the prefix, so a status pill has to narrow the list to the 55 that
// match it. Seeded rows stay behind in the disposable tenant; nobody may
// DELETE tasks at all (they are cancelled, never deleted).
const MATCHING = 55
const DRAFTS = 5

/**
 * Walks one list through shareable URLs: searched for `prefix` at 25 a page,
 * paged, narrowed by a status pill, sorted Z to A, then reached by a stale link
 * past its end.
 *
 * @param page - A signed-in page.
 * @param prefix - What every seeded row's title starts with.
 * @param list - The list's name, the status pill that keeps the 55, the
 *   locator of a row's title, and how many rows the search finds.
 * @param afterSort - Checks of the list's own once it is sorted.
 */
async function walkList(
  page: Page,
  prefix: string,
  list: { name: string; status: string; title: string; found: number },
  afterSort?: () => Promise<void>
): Promise<void> {
  const plural = list.name.toLowerCase()
  const heading = page.getByRole("heading", { level: 1 })
  const pagination = page.getByRole("navigation", { name: "Pagination" })
  const firstTitle = page.locator(list.title).first()
  const viewOptions = page.getByRole("button", { name: /^View options/ })
  const param = (name: string): string | null => new URL(page.url()).searchParams.get(name)

  await page.goto(`/${plural}?size=25`)

  // Searching the list from search keeps its page size and starts on page one.
  await searchList(page, list.name, prefix)
  await expect.poll(() => param("q")).toBe(prefix)
  expect(param("size")).toBe("25")
  await expect(heading).toHaveAccessibleName(`${list.name} ${list.found} ${plural}`)
  await expect(pagination).toHaveText(`1–25 of ${list.found}`)
  await expect(pagination.getByRole("link", { name: "Previous page" })).toHaveCount(0)

  await pagination.getByRole("link", { name: "Next page" }).click()
  await expect(pagination).toHaveText(`26–50 of ${list.found}`)
  expect(param("page")).toBe("2")

  // A status pill narrows the view, keeps the search and page size, and
  // restarts the paging.
  await page
    .getByRole("navigation", { name: `Filter ${plural} by status` })
    .getByRole("link", { name: list.status })
    .click()
  await expect.poll(() => param("status")).toBe(list.status.toLowerCase())
  expect([param("q"), param("size"), param("page")]).toEqual([prefix, "25", null])
  await expect(heading).toHaveAccessibleName(`${list.name} ${MATCHING} ${plural}`)
  await expect(pagination).toHaveText(`1–25 of ${MATCHING}`)

  // Order lives behind the view menu, which marks itself once changed.
  await waitForHydration(viewOptions)
  await viewOptions.click()
  await page.getByRole("menuitem", { name: "Title, Z to A" }).click()
  await expect.poll(() => param("sort")).toBe("-title")
  await expect(viewOptions).toHaveAccessibleName("View options (changed)")
  await expect(firstTitle).toHaveText(`${prefix} 55`)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await afterSort?.()

  // A stale link past the end lands on the last page that still has rows.
  const staleLink = new URL(page.url())
  staleLink.searchParams.set("page", "9999")
  await page.goto(`${staleLink.pathname}${staleLink.search}`)
  await expect.poll(() => param("page")).toBe("3")
  await expect(pagination).toHaveText("51–55 of 55")
  await expect(firstTitle).toHaveText(`${prefix} 05`)
  await expect(pagination.getByRole("link", { name: "Next page" })).toHaveCount(0)
}

/** `${prefix} 01` to `${prefix} 55`, then `${prefix} draft 1` to 5. */
function titles(prefix: string): { title: string; matching: boolean }[] {
  return [
    ...Array.from({ length: MATCHING }, (_, index) => ({
      matching: true,
      title: `${prefix} ${String(index + 1).padStart(2, "0")}`,
    })),
    ...Array.from({ length: DRAFTS }, (_, index) => ({ matching: false, title: `${prefix} draft ${index + 1}` })),
  ]
}

test("searches, filters, sorts, and pages tasks through shareable URLs", async ({ admin, pageAs, tenant }) => {
  const prefix = uniqueName("Paging")
  const owner = tenant.users.owner_admin
  const { error } = await admin.from("tasks").insert(
    titles(prefix)
      .filter(({ matching }) => matching)
      .map(({ title }, index) => ({
        created_by: owner.id,
        due_at: new Date(Date.UTC(2031, 0, 1, index)).toISOString(),
        org_id: tenant.organizationId,
        title,
        updated_by: owner.id,
      }))
  )
  if (error) throw error

  const page = await pageAs("owner_admin")
  await walkList(page, prefix, { found: MATCHING, name: "Tasks", status: "Open", title: '[data-slot="task-row"] a' })

  // New tasks are created from a dialog, like People's invite.
  const newTask = page.getByRole("button", { name: "New task" })
  await waitForHydration(newTask)
  await newTask.click()
  const dialog = page.getByRole("dialog", { name: "New task" })
  await dialog.getByLabel("Title").fill(`${prefix} created`)
  await dialog.getByRole("button", { name: "Create task" }).click()
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}/)
  await expect(page.getByText(`${prefix} created`).first()).toBeVisible()
})

test("searches, filters, sorts, and pages templates through shareable URLs", async ({ admin, pageAs, tenant }) => {
  // The first three published templates carry the prefix as their category.
  const prefix = uniqueName("Library")
  const content = createBlankTemplateContent()
  const publishedAt = new Date().toISOString()
  const { error } = await admin.from("document_templates").insert(
    titles(prefix).map(({ matching, title }, index) => ({
      category: index < 3 ? prefix : null,
      content,
      org_id: tenant.organizationId,
      published_at: matching ? publishedAt : null,
      status: matching ? "published" : "draft",
      title,
    }))
  )
  if (error) throw error

  const page = await pageAs("owner_admin")
  await walkList(page, prefix, {
    found: MATCHING + DRAFTS,
    name: "Templates",
    status: "Published",
    title: '[data-slot="template-card"] [data-slot="template-title"]',
  })

  // So does the category, which also starts again on page one.
  const viewOptions = page.getByRole("button", { name: /^View options/ })
  await waitForHydration(viewOptions)
  await viewOptions.click()
  await page.getByRole("menuitem", { exact: true, name: prefix }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get("category")).toBe(prefix)
  expect(new URL(page.url()).searchParams.get("page")).toBeNull()
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("Templates 3 templates")
  await expect(page.locator('[data-slot="template-card"] [data-slot="template-title"]').first()).toHaveText(`${prefix} 03`)
})

test("searches, filters, sorts, pages, and exports submissions through shareable URLs", async ({ admin, pageAs, tenant }) => {
  const prefix = uniqueName("Queue")
  const owner = tenant.users.owner_admin
  const template = await seedTemplate(admin, tenant.organizationId, `${prefix} form`, "published")
  const submittedAt = new Date().toISOString()
  const { error } = await admin.from("submissions").insert(
    titles(prefix).map(({ matching, title }) => ({
      created_by: owner.id,
      org_id: tenant.organizationId,
      status: matching ? "submitted" : "draft",
      submitted_at: matching ? submittedAt : null,
      submitted_by: matching ? owner.id : null,
      template_id: template.id,
      template_revision: 1,
      template_snapshot: template.content,
      title,
      updated_by: owner.id,
      values: { [template.textFieldKey]: "REF-4417" },
    }))
  )
  if (error) throw error

  const page = await pageAs("owner_admin")
  await walkList(
    page,
    prefix,
    { found: MATCHING + DRAFTS, name: "Submissions", status: "Submitted", title: '[data-slot="submission-row"] a' },
    async () => {
      // The export carries the whole view, not the page on screen: every
      // submitted row, in the view's order, and none of the drafts.
      await page.getByRole("button", { name: /^View options/ }).click()
      const exportHref = await page.getByRole("menuitem", { name: "Download CSV" }).getAttribute("href")
      await page.keyboard.press("Escape")
      const exportUrl = new URL(exportHref ?? "", page.url())
      expect(exportUrl.pathname).toBe("/api/export/submissions")
      expect(["status", "q", "sort", "page", "size"].map((name: string) => exportUrl.searchParams.get(name))).toEqual([
        "submitted",
        prefix,
        "-title",
        null,
        null,
      ])
      const exported = await page.request.get(exportUrl.toString())
      expect(exported.status()).toBe(200)
      const lines = (await exported.text()).trim().split("\n")
      expect(lines).toHaveLength(MATCHING + 1)
      expect(lines[1]).toContain(`${prefix} 55`)
    }
  )
})
