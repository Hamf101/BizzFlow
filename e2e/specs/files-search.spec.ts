import { expect, test, uniqueName } from "../support/fixtures"
import { retryConcurrentChange } from "../support/retry"

test("finds a file filed anywhere, and only for a member who may open it", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const owner = tenant.users.owner_admin
  const folderName = uniqueName("Private folder")
  const title = uniqueName("Buried lease")

  const { data: folder, error: folderError } = await retryConcurrentChange(() =>
    admin
      .from("folders")
      .insert({
        created_by: owner.id,
        name: folderName,
        org_id: tenant.organizationId,
        updated_by: owner.id,
      })
      .select("id")
      .single()
  )
  if (folderError) throw folderError

  const { error } = await retryConcurrentChange(() =>
    admin.from("documents").insert({
      created_by: owner.id,
      folder_id: folder.id,
      org_id: tenant.organizationId,
      source_kind: "upload",
      title,
      updated_by: owner.id,
    })
  )
  if (error) throw error

  // The owner searches from the top of Files and still finds it, with the
  // folder it is filed in where the list otherwise says when it changed.
  const page = await pageAs("owner_admin")
  await page.goto(`/documents?q=${encodeURIComponent(title)}`)

  const found = page
    .locator('[data-slot="file-tile"]')
    .filter({ has: page.getByRole("link", { exact: true, name: title }) })
  await expect(found).toHaveCount(1)
  await expect(found.locator('[data-slot="file-retention"]')).toHaveText(
    `Files › ${folderName}`
  )

  // Staff were never given that folder, so the search does not disclose it.
  const staff = await pageAs("staff")
  await staff.goto(`/documents?q=${encodeURIComponent(title)}`)
  await expect(
    staff.getByRole("heading", { level: 1 })
  ).toHaveAccessibleName("Files 0 items")
  await expect(staff.getByText(title)).toHaveCount(0)
})
