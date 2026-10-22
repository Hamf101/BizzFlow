import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedFolder } from "../support/seed"

test("a task is assigned by typing part of someone's name and picking them", async ({ admin, pageAs, tenant }) => {
  const page = await pageAs("manager")
  const title = uniqueName("Call the supplier")

  await page.goto("/tasks")
  const newTask = page.getByRole("button", { name: "New task" })
  await waitForHydration(newTask)
  await newTask.click()
  await page.getByLabel("Title").fill(title)
  const assignee = page.getByRole("combobox", { name: "Assignee" })
  await assignee.fill("staf")
  // Only the people who match are offered.
  await expect(page.getByRole("option")).toHaveCount(1)
  await page.getByRole("option", { name: /E2E staff/ }).click()
  await page.getByRole("button", { name: "Create task" }).click()

  await expect
    .poll(async () => (await admin.from("tasks").select("assigned_to").eq("org_id", tenant.organizationId).eq("title", title).maybeSingle()).data?.assigned_to)
    .toBe(tenant.users.staff.id)
})

test("a folder is moved into another found by name, wherever it is", async ({ admin, pageAs, tenant }) => {
  const owner = tenant.users.owner_admin
  const parent = await seedFolder(admin, tenant.organizationId, owner.id, uniqueName("Clients"))
  const moving = uniqueName("Loose papers")
  const target = uniqueName("Archive 2025")
  await seedFolder(admin, tenant.organizationId, owner.id, moving, parent)
  // Deep, and among enough folders that browsing one by one would be slow.
  const deep = await seedFolder(admin, tenant.organizationId, owner.id, uniqueName("Years"), parent)
  const targetId = await seedFolder(admin, tenant.organizationId, owner.id, target, deep)
  for (let n = 0; n < 6; n += 1) await seedFolder(admin, tenant.organizationId, owner.id, uniqueName(`Other ${n}`), parent)

  const page = await pageAs("owner_admin")
  await page.goto(`/documents?folderId=${parent}`)
  const tile = page.locator('[data-slot="file-tile"]').filter({ has: page.getByRole("link", { exact: true, name: moving }) })
  await waitForHydration(tile)
  await tile.getByRole("button", { name: /Actions for/ }).click()
  await page.getByRole("menuitem", { exact: true, name: "Move to…" }).click()

  await page.getByRole("searchbox", { name: "Search folders" }).fill(target.slice(0, 12))
  await page.getByRole("button", { name: new RegExp(target) }).click()
  await page.getByRole("button", { name: "Move here" }).click()

  await expect
    .poll(async () => (await admin.from("folders").select("parent_folder_id").eq("org_id", tenant.organizationId).eq("name", moving).maybeSingle()).data?.parent_folder_id)
    .toBe(targetId)
})
