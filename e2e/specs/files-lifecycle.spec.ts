import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"

test("files a new folder, then archives, restores, trashes, and purges it from its menu", async ({
  pageAs,
}, testInfo) => {
  // Both device projects walk this at once against the shared tenant, so each
  // works on its own folder.
  const name = uniqueName("Leases")
  const page = await pageAs("owner_admin")
  if (testInfo.project.use.viewport) {
    await page.setViewportSize(testInfo.project.use.viewport)
  }
  const states = page.getByRole("navigation", { name: "Show files by state" })
  const folderLink = page.getByRole("link", { exact: true, name })
  const actions = page.getByRole("button", { name: `Actions for ${name}` })
  const param = (key: string): string | null =>
    new URL(page.url()).searchParams.get(key)
  const choose = async (item: string): Promise<void> => {
    await waitForHydration(actions)
    await actions.click()
    await page.getByRole("menuitem", { exact: true, name: item }).click()
  }

  await page.goto("/documents")

  // The journey reads rows, so it switches to List; the choice is remembered.
  const listView = page.getByRole("button", { name: "List view" })
  await listView.click()
  await expect(listView).toHaveAttribute("aria-pressed", "true")

  // A folder is named in a dialog from the New menu.
  const newMenu = page.getByRole("button", { name: "New" })
  await waitForHydration(newMenu)
  await newMenu.click()
  await page.getByRole("menuitem", { name: "Folder" }).click()
  const naming = page.getByRole("dialog", { name: "New folder" })
  await naming.getByLabel("Name").fill(name)
  await naming.getByRole("button", { name: "Create folder" }).click()
  await expect(naming).toBeHidden()
  await expect(folderLink).toBeVisible()

  // Opening it shows where it sits, and the path leads back out.
  await folderLink.click()
  await expect.poll(() => param("folderId")).not.toBeNull()
  const path = page.getByRole("navigation", { name: "Folder path" })
  await expect(path.getByText(name, { exact: true })).toHaveAttribute(
    "aria-current",
    "page"
  )
  await expect(page.getByText("This folder is empty.")).toBeVisible()
  await path.getByRole("link", { name: "Files" }).click()
  await expect.poll(() => param("folderId")).toBeNull()

  // Archiving takes it out of Active; Archived brings it back.
  await choose("Archive")
  await expect(folderLink).toHaveCount(0)
  await states.getByRole("link", { name: "Archived" }).click()
  await expect.poll(() => param("view")).toBe("archived")
  await choose("Restore")
  await expect(folderLink).toHaveCount(0)

  await states.getByRole("link", { name: "Active" }).click()
  await expect.poll(() => param("view")).toBeNull()
  await choose("Move to Trash")
  await expect(folderLink).toHaveCount(0)

  // Deleting for good asks for the exact name, then queues the purge, after
  // which the folder offers nothing more.
  await states.getByRole("link", { name: "Trash" }).click()
  await expect.poll(() => param("view")).toBe("trash")
  await choose("Delete permanently…")
  const purge = page.getByRole("dialog", { name: `Delete ${name} permanently?` })
  await purge
    .getByLabel("Type the exact folder name to delete permanently")
    .fill(name)
  await purge.getByRole("button", { name: `Permanently delete ${name}` }).click()
  await expect(
    page
      .locator('[data-slot="file-row"]')
      .filter({ has: folderLink })
      .locator('[data-slot="file-retention"]')
  ).toHaveText("Permanent deletion pending")
  await expect(actions).toHaveCount(0)
})
