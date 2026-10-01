import { randomUUID } from "node:crypto"

import type { Page } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { retryConcurrentChange } from "../support/retry"

test.describe.configure({ mode: "serial" })

async function seedFolder(admin: SupabaseClient, organizationId: string, ownerId: string, name: string): Promise<string> {
  const id = randomUUID()
  const { error } = await retryConcurrentChange(() =>
    admin.from("folders").insert({ created_by: ownerId, id, name, org_id: organizationId, updated_by: ownerId })
  )
  if (error) throw error
  return id
}

async function seedDocument(
  admin: SupabaseClient,
  organizationId: string,
  creatorId: string,
  title: string,
  folderId: string | null = null
): Promise<void> {
  const { error } = await retryConcurrentChange(() =>
    admin.from("documents").insert({
      created_by: creatorId,
      folder_id: folderId,
      org_id: organizationId,
      source_kind: "upload",
      title,
      updated_by: creatorId,
    })
  )
  if (error) throw error
}

async function openShare(page: Page, title: string) {
  await page.getByRole("button", { name: `Actions for ${title}` }).click()
  await page.getByRole("menuitem", { name: "Share…" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: `Share “${title}”` })).toBeVisible()
  return dialog
}

test("the person who made a document shares it with a manager, who hears about it, edits, and loses it again", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const title = uniqueName("Shared lease")
  const { manager, staff } = tenant.users
  await seedDocument(admin, tenant.organizationId, staff.id, title)

  const managerPage = await pageAs("manager")
  await managerPage.goto("/documents")
  await waitForHydration(managerPage.getByRole("link", { name: "Files" }).first())
  await expect(managerPage.getByRole("link", { exact: true, name: title })).toHaveCount(0)

  const staffPage = await pageAs("staff")
  await staffPage.goto("/documents")
  const dialog = await openShare(staffPage, title)
  await expect(dialog).toContainText("Owner, can always edit")
  await expect(dialog).toContainText("Owner admins always have access.")

  await dialog.getByLabel("Find a person or group").fill(manager.email)
  await dialog.getByRole("list", { name: "People you can add" }).getByRole("button", { name: new RegExp(manager.email) }).click()
  const access = dialog.getByLabel("Access for E2E manager")
  await expect(access).toHaveValue("viewer")

  // The manager is told without reloading, and can now open it.
  await expect(managerPage.getByText(`shared “${title}” with you`)).toBeVisible({ timeout: 15_000 })
  await managerPage.reload()
  await expect(managerPage.getByRole("link", { exact: true, name: title })).toBeVisible()

  await access.selectOption("contributor")
  await expect(access).toHaveValue("contributor")
  await access.selectOption("remove")
  await expect(dialog.getByLabel("Access for E2E manager")).toHaveCount(0)
  await dialog.getByRole("button", { name: "Done" }).click()

  await managerPage.reload()
  await expect(managerPage.getByRole("link", { exact: true, name: title })).toHaveCount(0)
})

test("a folder shared with a role reaches what is in it, until the document stops taking it in", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const name = uniqueName("Clients")
  const title = `${name} contract`
  const owner = tenant.users.owner_admin
  const folderId = await seedFolder(admin, tenant.organizationId, owner.id, name)
  await seedDocument(admin, tenant.organizationId, owner.id, title, folderId)

  const ownerPage = await pageAs("owner_admin")
  const staffPage = await pageAs("staff")
  await staffPage.goto(`/documents?folderId=${folderId}`)
  await expect(staffPage.getByText("Folder unavailable")).toBeVisible()

  // Share the folder with everyone who is staff.
  await ownerPage.goto("/documents")
  const folderDialog = await openShare(ownerPage, name)
  await expect(folderDialog.getByText("From the folder")).toHaveCount(0)
  await folderDialog.getByRole("list", { name: "People you can add" }).getByRole("button", { name: "Everyone who is staff" }).click()
  await expect(folderDialog.getByLabel("Access for Everyone who is staff")).toHaveValue("viewer")
  await folderDialog.getByRole("button", { name: "Done" }).click()

  await staffPage.goto(`/documents?folderId=${folderId}`)
  const link = staffPage.getByRole("link", { exact: true, name: title })
  await expect(link).toBeVisible()
  // They can read it, but it is not theirs to share.
  await expect(staffPage.getByRole("button", { name: `Actions for ${title}` })).toHaveCount(0)

  // The document alone chooses not to take in what the folder gives.
  await ownerPage.goto(`/documents?folderId=${folderId}`)
  const documentDialog = await openShare(ownerPage, title)
  await expect(documentDialog).toContainText("Everyone who is staff")
  const inherit = documentDialog.getByRole("switch", { name: `Also share with everyone who can open “${name}”` })
  await expect(inherit).toBeChecked()
  await inherit.click()
  await expect(inherit).not.toBeChecked()

  await staffPage.reload()
  await expect(link).toHaveCount(0)
})

test("several files are shared at once, and staff who can edit one can pass it on", async ({ admin, pageAs, tenant }) => {
  const name = uniqueName("Batch")
  const titles = [`${name} A`, `${name} B`]
  const owner = tenant.users.owner_admin
  const { staff } = tenant.users
  for (const title of titles) await seedDocument(admin, tenant.organizationId, owner.id, title)

  const ownerPage = await pageAs("owner_admin")
  await ownerPage.goto("/documents")
  const tile = (title: string) =>
    ownerPage.locator('[data-slot="file-tile"]').filter({ has: ownerPage.getByRole("link", { exact: true, name: title }) })
  await waitForHydration(tile(titles[0]))
  for (const title of titles) {
    await tile(title).getByRole("link", { exact: true, name: title }).click({ modifiers: ["ControlOrMeta"] })
  }

  // Share both from the selection bar.
  const bar = ownerPage.getByRole("group", { name: "Selection" })
  await bar.getByRole("button", { name: "Share 2 items" }).click()
  const dialog = ownerPage.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "Share “2 items”" })).toBeVisible()
  await dialog.getByLabel("Find a person or group").fill(staff.email)
  await dialog.getByRole("list", { name: "People you can add" }).getByRole("button", { name: new RegExp(staff.email) }).click()
  const access = dialog.getByLabel("Access for E2E staff")
  await expect(access).toHaveValue("viewer")
  await access.selectOption("contributor")
  await expect(access).toHaveValue("contributor")
  await dialog.getByRole("button", { name: "Done" }).click()

  // Both arrive, and because staff can edit them, staff can share them too.
  const staffPage = await pageAs("staff")
  await staffPage.goto("/documents")
  for (const title of titles) {
    await expect(staffPage.getByRole("link", { exact: true, name: title })).toBeVisible()
  }
  const shareDialog = await openShare(staffPage, titles[0] as string)
  await expect(shareDialog).toContainText("Owner admins always have access.")
})
