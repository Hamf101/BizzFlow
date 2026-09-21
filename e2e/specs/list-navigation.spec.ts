import type { Page } from "@playwright/test"

import { expect, test, uniqueName } from "../support/fixtures"
import { retryConcurrentChange } from "../support/retry"

test.use({ screenshot: "off", trace: "off", video: "off" })

/** The tabs a member moves between, and the heading each one arrives at. */
const TABS = [
  { heading: "Files", href: "/documents" },
  { heading: "Templates", href: "/templates" },
  { heading: "Tasks", href: "/tasks" },
  { heading: "Submissions", href: "/submissions" },
] as const

/** How long the destination's own heading may take to appear, in ms. */
const WARM_BUDGET = { chromium: 100, "mobile-chrome": 150 } as const

/**
 * Clicks a tab and times how long its destination takes to become readable.
 *
 * Measured in the page, from the click to the destination's own heading, so
 * the number is content the member can use rather than a changed address.
 *
 * @param page - The signed-in page.
 * @param tab - Where to go, and the heading that proves arrival.
 * @returns Milliseconds from the click to that heading, or null where this
 *   viewport does not offer the tab — a phone keeps some behind a sheet.
 */
async function timeSwitch(
  page: Page,
  tab: { heading: string; href: string }
): Promise<number | null> {
  return page.evaluate(
    async ({ heading, href }: { heading: string; href: string }) => {
      const link = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(`a[href="${href}"]`)
      ).find((candidate) => {
        const box = candidate.getBoundingClientRect()

        // A closed sheet keeps its links laid out, just off the screen.
        return (
          box.width > 0 &&
          box.left >= 0 &&
          box.top >= 0 &&
          box.right <= window.innerWidth &&
          box.bottom <= window.innerHeight
        )
      })

      if (!link) {
        return null
      }

      // The heading carries the list's own count, so this waits for the
      // destination's data rather than for its title alone.
      const counted = new RegExp(`^${heading}\\s+\\d`)
      const arrived = (): boolean =>
        counted.test(document.querySelector("h1")?.textContent ?? "")
      const started = performance.now()

      link.click()

      await new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          if (arrived()) {
            observer.disconnect()
            resolve()
          }
        })

        observer.observe(document.documentElement, {
          characterData: true,
          childList: true,
          subtree: true,
        })
      })

      return performance.now() - started
    },
    tab
  )
}

test("searching a list arrives without reloading the document", async ({
  pageAs,
}, testInfo) => {
  const page = await pageAs("owner_admin")
  await page.goto("/documents")

  // A document load starts a new performance timeline; a transition does not.
  const timeline = await page.evaluate(() => performance.timeOrigin)
  await page.getByLabel("Search files").fill(uniqueName("Nothing filed as"))
  const asked = Date.now()
  await page.getByLabel("Search files").press("Enter")

  await expect(page).toHaveURL(/[?&]q=/)
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    /Files 0 items/
  )
  console.log(
    `list-navigation (${testInfo.project.name}): search answered in ${Date.now() - asked} ms`
  )
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeline)
})

test("moves between warm tabs within the budget", async ({
  pageAs,
}, testInfo) => {
  test.setTimeout(120_000)
  const page = await pageAs("owner_admin")
  const budget =
    WARM_BUDGET[testInfo.project.name as keyof typeof WARM_BUDGET] ?? 100

  // Each destination is reached once on its own, which both reports what an
  // uncached navigation costs and leaves the tab warm for the measurement.
  const cold: number[] = []
  for (const tab of TABS) {
    const started = Date.now()
    await page.goto(tab.href)
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      tab.heading
    )
    cold.push(Date.now() - started)
  }

  const warm: number[] = []
  const measured = new Set<string>()

  for (let round = 0; round < 5; round += 1) {
    for (const tab of TABS) {
      const elapsed = await timeSwitch(page, tab)

      if (elapsed === null) {
        continue
      }

      // The number only means something if the switch really happened.
      expect(new URL(page.url()).pathname).toBe(tab.href)
      measured.add(tab.heading)
      warm.push(elapsed)
    }
  }

  expect(measured.size).toBeGreaterThan(1)

  const sorted = [...warm].sort((left: number, right: number) => left - right)
  const percentile95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0
  // A budget is what one member waits for, so it only holds when the machine
  // is theirs: the parallel suite reports the numbers, `--workers=1` enforces
  // them.
  const enforced = testInfo.config.workers === 1

  console.log(
    `list-navigation (${testInfo.project.name}): warm tab switches n=${warm.length} ` +
      `median ${Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0)} ms, ` +
      `p95 ${Math.round(percentile95)} ms, worst ${Math.round(sorted.at(-1) ?? 0)} ms ` +
      `(budget ${budget} ms) over ${[...measured].join(", ")}. ` +
      `Cold, reported separately: ${cold.join(" ms, ")} ms. ` +
      `${enforced ? "Budget enforced" : "Reported only: the suite is sharing this machine"}.`
  )

  if (enforced) {
    expect(percentile95).toBeLessThanOrEqual(budget)
  } else {
    expect(warm.length).toBeGreaterThan(0)
  }
})

test("returns to a list where it was left, filters and all", async ({
  admin,
  pageAs,
  tenant,
}, testInfo) => {
  const name = uniqueName("Long folder")
  const owner = tenant.users.owner_admin
  const { data: folder, error: folderError } = await retryConcurrentChange(() =>
    admin
      .from("folders")
      .insert({
        created_by: owner.id,
        name,
        org_id: tenant.organizationId,
        updated_by: owner.id,
      })
      .select("id")
      .single()
  )
  if (folderError) throw folderError

  const { error } = await retryConcurrentChange(() =>
    admin.from("documents").insert(
      Array.from({ length: 60 }, (_, index: number) => ({
        created_by: owner.id,
        folder_id: folder.id,
        org_id: tenant.organizationId,
        source_kind: "upload",
        title: `${name} ${String(index + 1).padStart(2, "0")}`,
        updated_by: owner.id,
      }))
    )
  )
  if (error) throw error

  const page = await pageAs("owner_admin")
  if (testInfo.project.use.viewport) {
    await page.setViewportSize(testInfo.project.use.viewport)
  }

  const list = `/documents?folderId=${folder.id}&sort=-modified`
  await page.goto(list)
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    "Files 60 items"
  )

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const left = await page.evaluate(() => window.scrollY)

  expect(left).toBeGreaterThan(0)

  await page.getByRole("link", { exact: true, name: `${name} 60` }).click()
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}/)

  await page.goBack()
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    "Files 60 items"
  )
  expect(new URL(page.url()).search).toBe(new URL(list, page.url()).search)
  await expect
    .poll(async () => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(left / 2)
})
