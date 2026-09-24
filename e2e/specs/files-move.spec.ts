import { randomUUID } from "node:crypto"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { retryConcurrentChange } from "../support/retry"

test("moves a file into a folder from its menu, and puts it back with Undo", async ({
  admin,
  pageAs,
  tenant,
}, testInfo) => {
  // Both device projects walk this at once against the shared tenant, so each
  // works on its own folders and file.
  const name = uniqueName("Move")
  const folderName = `${name} Clients`
  const childName = `${name} 2026`
  const title = `${name} invoice.pdf`
  const owner = tenant.users.owner_admin
  const seedFolder = async (
    folderName: string,
    parentFolderId: string | null
  ): Promise<string> => {
    const id = randomUUID()
    const { error } = await retryConcurrentChange(() =>
      admin.from("folders").insert({
        created_by: owner.id,
        id,
        name: folderName,
        org_id: tenant.organizationId,
        parent_folder_id: parentFolderId,
        updated_by: owner.id,
      })
    )
    if (error) throw error

    return id
  }

  const parent = await seedFolder(folderName, null)
  await seedFolder(childName, parent)
  const { error } = await retryConcurrentChange(() =>
    admin.from("documents").insert({
      created_by: owner.id,
      org_id: tenant.organizationId,
      source_kind: "upload",
      title,
      updated_by: owner.id,
    })
  )
  if (error) throw error

  const page = await pageAs("owner_admin")
  if (testInfo.project.use.viewport) {
    await page.setViewportSize(testInfo.project.use.viewport)
  }
  const actions = page.getByRole("button", { name: `Actions for ${title}` })
  const fileLink = page.getByRole("link", { exact: true, name: title })
  const dialog = page.getByRole("dialog")

  await page.goto("/documents")
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
  await expect(fileLink).toHaveCount(0)
  await page.getByRole("link", { exact: true, name: folderName }).click()
  await page.getByRole("link", { exact: true, name: childName }).click()
  await expect(fileLink).toBeVisible()

  // Undo takes it back where it was.
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(page.getByText("Undone")).toBeVisible()
  await page.goto("/documents")
  await expect(fileLink).toBeVisible()
})
