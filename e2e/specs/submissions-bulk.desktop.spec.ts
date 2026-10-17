import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedSubmission, seedTemplate } from "../support/seed"

test("a reviewer starts and approves several submissions at once", async ({ admin, pageAs, tenant }) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Bulk"), "published")
  const prefix = uniqueName("Bulk run")
  const titles = [`${prefix} one`, `${prefix} two`]
  const ids = await Promise.all(titles.map((title) => seedSubmission(admin, tenant.organizationId, template, title, tenant.users.staff.id)))
  const statuses = async (): Promise<string[]> => {
    const { data } = await admin.from("submissions").select("status").in("id", ids)
    return (data ?? []).map((row) => row.status as string)
  }
  const manager = await pageAs("manager")
  const link = (title: string) => manager.getByRole("link", { exact: true, name: title })
  const bar = manager.getByRole("group", { name: "Selection" })

  await manager.goto(`/submissions?q=${encodeURIComponent(prefix)}`)
  await waitForHydration(link(titles[0]))
  await link(titles[0]).click({ modifiers: ["ControlOrMeta"] })
  await link(titles[1]).click({ modifiers: ["ControlOrMeta"] })
  await expect(bar).toContainText("2 selected")
  await bar.getByRole("button", { name: "Start review" }).click()
  await expect(manager.getByText("2 submissions taken on for review")).toBeVisible()
  await expect.poll(statuses).toEqual(["in_review", "in_review"])

  // A right-click offers the same step for the selection it makes.
  await link(titles[0]).click({ modifiers: ["ControlOrMeta"] })
  await link(titles[1]).click({ modifiers: ["ControlOrMeta"] })
  await link(titles[1]).click({ button: "right" })
  await manager.getByRole("menuitem", { name: "Approve" }).click()
  await expect(manager.getByText("2 submissions approved")).toBeVisible()
  await expect.poll(statuses).toEqual(["approved", "approved"])
})
