import { expect, test, uniqueName } from "../support/fixtures"
import { retryConcurrentChange } from "../support/retry"
import { openSearch } from "../support/search"
import { seedFolder } from "../support/seed"

test.use({ screenshot: "off", trace: "off", video: "off" })

test("search arrives at what it found without reloading the document", async ({
  pageAs,
  tenant,
}, testInfo) => {
  const page = await pageAs("owner_admin")
  const { email } = tenant.users.staff
  await page.goto("/documents")

  // A document load starts a new performance timeline; a transition does not.
  const timeline = await page.evaluate(() => performance.timeOrigin)
  const search = await openSearch(page)
  await search.getByRole("combobox", { name: "Search" }).fill(email)
  await expect(search.getByRole("option").first()).toContainText(email)
  const asked = Date.now()
  await page.keyboard.press("Enter")

  await expect(page).toHaveURL(/\/people\?q=/)
  await expect(page.locator('[data-slot="list-query"]')).toContainText(email)
  console.log(
    `list-navigation (${testInfo.project.name}): search answered in ${Date.now() - asked} ms`
  )
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeline)
})

test("search shows what was just opened before a letter is typed, and answers the first letter", async ({ pageAs }) => {
  const page = await pageAs("manager")
  await page.goto("/dashboard")
  // Kept once the server answers; leaving on the request alone could cancel it.
  const opened = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/opened"))
  await page.getByRole("button", { name: "New document" }).click()
  await page.waitForURL(/\/documents\/[0-9a-f-]+\/edit/)
  const documentId = new URL(page.url()).pathname.split("/")[2] as string
  expect((await opened).status(), "the visit is recorded").toBeLessThan(300)

  await page.goto("/dashboard")
  const search = await openSearch(page)
  // Nothing typed: the document just opened is already there.
  await expect(search.locator(`[role="option"][href*="${documentId}"]`)).toBeVisible()

  await search.getByRole("combobox", { name: "Search" }).fill("U")
  await expect(search.locator(`[role="option"][href*="${documentId}"]`)).toBeVisible()
})

test("returns to a list where it was left, filters and all", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const name = uniqueName("Long folder")
  const owner = tenant.users.owner_admin
  const folderId = await seedFolder(admin, tenant.organizationId, owner.id, name)

  const { error } = await retryConcurrentChange(() =>
    admin.from("documents").insert(
      Array.from({ length: 60 }, (_, index: number) => ({
        created_by: owner.id,
        folder_id: folderId,
        org_id: tenant.organizationId,
        source_kind: "upload",
        title: `${name} ${String(index + 1).padStart(2, "0")}`,
        updated_by: owner.id,
      }))
    )
  )
  if (error) throw error

  const page = await pageAs("owner_admin")

  const list = `/documents?folderId=${folderId}&sort=-modified`
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
