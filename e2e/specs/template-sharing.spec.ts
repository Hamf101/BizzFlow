import type { Page } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"

test.describe.configure({ mode: "serial" })

// The library's title on a card; the same words also print on the card's page preview.
const shown = (page: Page, title: string) => page.locator('[data-slot="template-title"]', { hasText: title })
const openable = (page: Page, title: string) => page.locator('a[data-slot="template-title"]', { hasText: title })

async function seedMadeBy(admin: SupabaseClient, organizationId: string, makerId: string, title: string): Promise<string> {
  const template = await seedTemplate(admin, organizationId, title, "published")
  const { error } = await admin.from("document_templates").update({ created_by: makerId }).eq("id", template.id)
  if (error) throw error
  return template.id
}

test("staff keep their own template to chosen people, then let a manager use it and edit it", async ({ admin, pageAs, tenant }) => {
  const title = uniqueName("Onboarding pack")
  const { manager, staff } = tenant.users
  const templateId = await seedMadeBy(admin, tenant.organizationId, staff.id, title)

  const staffPage = await pageAs("staff")
  await staffPage.goto("/templates")
  // Their own template opens in the editor; staff made it, so it is theirs to change and to share.
  await waitForHydration(openable(staffPage, title))
  await expect(openable(staffPage, title)).toHaveAttribute("href", `/templates/${templateId}/edit`)

  await staffPage.getByRole("button", { name: `Actions for ${title}` }).click()
  await staffPage.getByRole("menuitem", { name: "Share…" }).click()
  const dialog = staffPage.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: `Share “${title}”` })).toBeVisible()
  await expect(dialog).toContainText("Everyone who can see templates can use it")

  // One page of the manager's listens for the notice; another is opened to look at the library.
  const managerPage = await pageAs("manager")
  await managerPage.goto("/templates")
  await expect(shown(managerPage, title)).toBeVisible()
  const looking = await managerPage.context().newPage()
  const look = async () => {
    await looking.goto("/templates")
    await waitForHydration(looking.getByRole("link", { name: "Templates" }).first())
  }

  // Keeping it to chosen people takes it away from everyone else, managers included.
  await dialog.getByRole("switch", { name: "Only people I choose" }).click()
  await expect(dialog).toContainText("Only you, owner admins and the people below can open it")
  await look()
  await expect(shown(looking, title)).toHaveCount(0)

  await dialog.getByLabel("Find a person or group").fill(manager.email)
  await dialog.getByRole("list", { name: "People you can add" }).getByRole("button", { name: new RegExp(manager.email) }).click()
  const access = dialog.getByLabel("Access for E2E manager")
  await expect(access.locator("option")).toHaveText(["Can view", "Can use", "Can edit", "Remove access"])
  await access.selectOption("user")
  await expect(access).toHaveValue("user")

  // They can use it, but it is still not theirs to change.
  await expect(managerPage.getByText(`shared the template “${title}” with you`)).toBeVisible({ timeout: 15_000 })
  await look()
  await expect(shown(looking, title)).toBeVisible()
  await expect(openable(looking, title)).toHaveCount(0)

  await access.selectOption("editor")
  await expect(access).toHaveValue("editor")
  await look()
  await expect(openable(looking, title)).toHaveAttribute("href", `/templates/${templateId}/edit`)
})

test("staff cannot edit or share a template someone else made", async ({ admin, pageAs, tenant }) => {
  const title = uniqueName("Manager's template")
  const templateId = await seedMadeBy(admin, tenant.organizationId, tenant.users.manager.id, title)

  const staffPage = await pageAs("staff")
  await staffPage.goto("/templates")
  await expect(shown(staffPage, title)).toBeVisible()
  await expect(openable(staffPage, title)).toHaveCount(0)

  // What the menu offers is copying, not editing or sharing.
  await staffPage.getByRole("button", { name: `Actions for ${title}` }).click()
  await expect(staffPage.getByRole("menuitem", { name: "Duplicate" })).toBeVisible()
  await expect(staffPage.getByRole("menuitem", { name: "Share…" })).toHaveCount(0)
  await expect(staffPage.getByRole("menuitem", { name: "Edit" })).toHaveCount(0)

  await staffPage.goto(`/templates/${templateId}/edit`)
  await expect(staffPage.getByRole("heading", { name: title })).toHaveCount(0)
})
