import { readFile } from "node:fs/promises"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"

test("narrows the audit log by kind, unfolds an event, and downloads exactly that view", async ({
  admin,
  pageAs,
  tenant,
}, testInfo) => {
  // Other specs record events in this tenant at the same time, so every
  // assertion either finds this spec's own events by reference or holds for
  // any event of the chosen kind.
  const reference = uniqueName("Audit")
  const owner = tenant.users.owner_admin
  const event = (action: string, targetType: string, step: number) => ({
    action,
    actor_user_id: owner.id,
    metadata: { reference, step },
    org_id: tenant.organizationId,
    target_type: targetType,
  })
  // The table's trigger assigns the sequence and chain hashes, so seeded
  // events are as tamper-evident as recorded ones.
  const { error } = await admin
    .from("audit_logs")
    .insert([
      event("task.created", "task", 1),
      event("document.created", "document", 2),
      event("task.status_changed", "task", 3),
    ])
  if (error) throw error

  const page = await pageAs("owner_admin")
  if (testInfo.project.use.viewport) {
    await page.setViewportSize(testInfo.project.use.viewport)
  }

  await page.goto("/audit-log")
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    /^Audit log \d+ events?$/
  )

  await page
    .getByRole("navigation", { name: "Filter events by kind" })
    .getByRole("link", { name: "Tasks" })
    .click()
  await expect.poll(() => new URL(page.url()).searchParams.get("kind")).toBe("tasks")
  const names = page.locator('[data-slot="audit-event-name"]')
  await expect(names.first()).toBeVisible()
  for (const name of await names.allTextContents()) {
    expect(name).toMatch(/^Task/)
  }

  const ownEvent = page.locator('[data-slot="audit-event"]', { hasText: reference }).first()
  await ownEvent.locator("summary").click()
  await expect(ownEvent.getByText(reference)).toBeVisible()

  const viewOptions = page.getByRole("button", { name: /^View options/ })
  await waitForHydration(viewOptions)
  await viewOptions.click()
  await expect(page.getByRole("menuitem", { name: "Oldest first" })).toBeVisible()
  const downloading = page.waitForEvent("download")
  await page.getByRole("menuitem", { name: "Download CSV" }).click()
  const download = await downloading
  const csv = await readFile(await download.path(), "utf8")
  const [header, ...rows] = csv.trim().split(/\r?\n/)

  // Every field is quoted (RFC 4180), so the target type reads as its own
  // quoted cell.
  expect(header).toBe(
    '"Log ID","Sequence","Timestamp","Action","Actor User ID","Target Type","Target ID","Metadata"'
  )
  expect(rows.filter((row) => row.includes(reference))).toHaveLength(2)
  expect(rows.filter((row) => row.includes("document.created") && row.includes(reference))).toHaveLength(0)
  for (const row of rows) {
    expect(row).toMatch(/","(task|task_reminder)","/)
  }
})
