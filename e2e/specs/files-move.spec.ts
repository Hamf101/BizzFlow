import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { retryConcurrentChange } from "../support/retry"
import { seedFolder } from "../support/seed"

test("moves a file into a folder from its menu, and puts it back with Undo", async ({
  admin,
  pageAs,
  tenant,
}) => {
  // Both device projects walk this at once against the shared tenant, so each
  // works on its own folders and file.
  const name = uniqueName("Move")
  const folderName = `${name} Clients`
  const childName = `${name} 2026`
  const title = `${name} invoice.pdf`
  const owner = tenant.users.owner_admin
  const parent = await seedFolder(admin, tenant.organizationId, owner.id, folderName)
  const child = await seedFolder(admin, tenant.organizationId, owner.id, childName, parent)
  const { data: file, error } = await retryConcurrentChange(() =>
    admin
      .from("documents")
      .insert({
        created_by: owner.id,
        org_id: tenant.organizationId,
        source_kind: "upload",
        title,
        updated_by: owner.id,
      })
      .select("id")
      .single()
  )
  if (error) throw error
  // A search reaches every folder, so where the file sits is read from the database.
  const fileFolder = async (): Promise<string | null> => {
    const { data, error: readError } = await admin.from("documents").select("folder_id").eq("id", file.id).single()
    if (readError) throw readError
    return data.folder_id as string | null
  }

  const page = await pageAs("owner_admin")
  const actions = page.getByRole("button", { name: `Actions for ${title}` })
  const fileLink = page.getByRole("link", { exact: true, name: title })
  const dialog = page.getByRole("dialog")

  // The shared tenant's Files outgrow one page, so the list opens on this run's names.
  await page.goto(`/documents?q=${encodeURIComponent(name)}`)
  await waitForHydration(actions)
  await actions.click()
  await page.getByRole("menuitem", { exact: true, name: "Move to…" }).click()

  // The picker opens where the file is and goes one folder in at a time.
  await expect(dialog.getByRole("button", { name: "Back" })).toHaveCount(0)
  await dialog.getByRole("button", { name: folderName }).click()
  await dialog.getByRole("button", { name: childName }).click()
  await expect(dialog.getByText(`${folderName} › ${childName}`)).toBeVisible()
  await dialog.getByRole("button", { name: "Move here" }).click()

  // The file leaves the top level and is waiting inside the subfolder.
  await expect(dialog).toBeHidden()
  await expect(page.getByText(`Moved to ${childName}`)).toBeVisible()
  await expect.poll(fileFolder).toBe(child)
  await page.getByRole("link", { exact: true, name: folderName }).click()
  await page.getByRole("link", { exact: true, name: childName }).click()
  await expect(fileLink).toBeVisible()

  // Undo takes it back where it was.
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(page.getByText("Undone")).toBeVisible()
  await expect.poll(fileFolder).toBeNull()
})
