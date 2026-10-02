import { randomUUID } from "node:crypto"

import type { Page } from "@playwright/test"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"
import { insertMember } from "../support/tenant"

// Opens a template's editor and waits for its room.
async function openTemplate(page: Page, templateId: string): Promise<void> {
  const opened = page.waitForResponse((response) => response.url().endsWith(`/api/templates/${templateId}/room`))
  await page.goto(`/templates/${templateId}/edit`)
  await waitForHydration(page.getByRole("button", { exact: true, name: "Publish" }))
  expect((await opened).ok()).toBe(true)
}

test("two people edit one template at once, see each other's words, and someone who loses access is refused", async ({
  admin,
  browser,
  pageAs,
  tenant,
}) => {
  const intro = { alignment: "left", id: randomUUID(), text: "Welcome aboard.", type: "paragraph" }
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Welcome pack"), "draft", [intro])
  const saved = () =>
    expect.poll(
      async () => {
        const { data, error } = await admin.from("document_templates").select("content").eq("id", template.id).single()
        if (error) throw error
        return data.content.blocks.map((block: { text?: string }) => block.text)
      },
      { timeout: 15_000 }
    )
  const owner = await pageAs("owner_admin")
  // A manager of their own, so taking their access away touches no other spec.
  const colleague = await insertMember(admin, tenant.organizationId, "manager", `collab-${randomUUID().slice(0, 8)}`)
  const manager = await (await browser.newContext()).newPage()
  await manager.goto("/login")
  await manager.getByLabel("Email").fill(colleague.email)
  await manager.getByLabel("Password", { exact: true }).fill(colleague.password)
  await manager.getByRole("button", { name: /log in/i }).click()
  await manager.waitForURL(/\/dashboard/, { timeout: 30_000 })
  await Promise.all([openTemplate(owner, template.id), openTemplate(manager, template.id)])

  // Each types in the same line, one at its end and one at its start, without waiting for the other.
  await owner.getByText("Welcome aboard.").click()
  await owner.keyboard.press("End")
  await manager.getByText("Welcome aboard.").click()
  await manager.keyboard.press("Home")
  await Promise.all([owner.keyboard.type(" We're glad you're here."), manager.keyboard.type("Hello! ")])

  const both = "Hello! Welcome aboard. We're glad you're here."
  await expect(owner.getByText(both)).toBeVisible()
  await expect(manager.getByText(both)).toBeVisible()
  await saved().toEqual([both])

  // What the room kept is what a newcomer opens.
  await manager.reload()
  await expect(manager.getByText(both)).toBeVisible()

  // Staff can't edit templates, so they can't open its room either.
  const staff = await pageAs("staff")
  await staff.goto("/dashboard")
  expect((await staff.request.post(`/api/templates/${template.id}/room`)).status()).toBe(403)

  // The colleague loses the right to edit templates: their next change is refused and dropped.
  try {
    const { error } = await admin
      .from("organization_memberships")
      .update({ role: "staff" })
      .eq("org_id", tenant.organizationId)
      .eq("user_id", colleague.id)
    if (error) throw error

    await manager.getByText(both).click()
    await manager.keyboard.press("End")
    await manager.keyboard.type(" Not kept.")
    await expect(manager.getByText("You cannot edit templates.")).toBeVisible()
    // Back to what the room kept, and nothing more can be changed here.
    await expect(manager.getByText(both, { exact: true })).toBeVisible()
    await expect(manager.locator('[data-slot="save-status"]')).toHaveText(/Editing stopped/)
    await saved().toEqual([both])
  } finally {
    await manager.context().close()
    await admin.auth.admin.deleteUser(colleague.id)
  }
})

test("people editing one template see where each other are, talk it over, and keep checkpoints", async ({ admin, pageAs, tenant }) => {
  const intro = { alignment: "left", id: randomUUID(), text: "Welcome aboard.", type: "paragraph" }
  const reference = {
    fieldKey: "client_reference",
    helpText: null,
    id: randomUUID(),
    label: "Client reference",
    multiline: false,
    placeholder: null,
    required: false,
    type: "text_field",
  }
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Together"), "draft", [intro, reference])
  const owner = await pageAs("owner_admin")
  const manager = await pageAs("manager")
  await Promise.all([openTemplate(owner, template.id), openTemplate(manager, template.id)])

  // The chat is theirs alone, heard from the moment they open it: a message
  // shows the other a dot until they open it.
  await manager.getByRole("button", { name: "Chat with E2E" }).click()
  await manager.getByRole("textbox", { name: "Message" }).fill("Publishing after lunch.")
  await manager.keyboard.press("Enter")
  await expect(owner.locator('[data-slot="chat-unread"]')).toBeVisible()
  await owner.getByRole("button", { name: "Chat with E2E" }).click()
  await expect(owner.getByText("Publishing after lunch.")).toBeVisible()
  await expect(owner.locator('[data-slot="chat-unread"]')).toBeHidden()
  await owner.keyboard.press("Escape")
  await manager.keyboard.press("Escape")

  // The manager writes at the end of the line; the owner sees their caret there, named.
  await manager.getByText("Welcome aboard.").click()
  await manager.keyboard.press("End")
  const caret = owner.locator('[data-slot="room-caret"]')
  await expect(caret).toHaveText("E2E")
  const end = await owner.getByText("Welcome aboard.").evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return [...range.getClientRects()].at(-1)!.right
  })
  await expect.poll(async () => Math.abs((await caret.boundingBox())!.x + 1 - end)).toBeLessThan(3)

  // The owner takes the field; the manager sees it outlined, named.
  await owner.locator(`[data-block-id="${reference.id}"]`).click({ position: { x: 4, y: 4 } })
  const outline = manager.locator('[data-slot="room-outline"]')
  await expect(outline).toHaveText("E2E")
  const field = await manager.locator(`[data-block-id="${reference.id}"]`).boundingBox()
  await expect.poll(async () => {
    const box = (await outline.boundingBox())!
    return box.x < field!.x && box.y < field!.y && box.x + box.width > field!.x + field!.width && box.y + box.height > field!.y + field!.height
  }).toBe(true)

  // A comment on the field shows beside it for the other, who replies and resolves it.
  await owner.getByRole("button", { exact: true, name: "Comments" }).click()
  await owner.getByRole("textbox", { name: "New comment" }).fill("Should this be required?")
  await owner.keyboard.press("Enter")
  await manager.getByRole("button", { name: "1 comment" }).click()
  await expect(manager.getByText("Should this be required?")).toBeVisible()
  await manager.getByRole("textbox", { name: "Reply" }).fill("Yes, making it so.")
  await manager.keyboard.press("Enter")
  await expect(owner.getByRole("button", { name: "2 comments" })).toBeVisible()
  await manager.getByRole("button", { name: "Resolve" }).click()
  await expect(owner.getByRole("button", { name: "2 comments" })).toBeHidden()

  // ⌘S keeps a checkpoint; bringing it back undoes what was written since, for everyone.
  await owner.getByText("Welcome aboard.").click()
  await owner.keyboard.press("ControlOrMeta+s")
  await expect(owner.getByText("Checkpoint saved")).toBeVisible()
  await owner.keyboard.press("End")
  await owner.keyboard.type(" Changed.")
  await expect(manager.getByText("Welcome aboard. Changed.")).toBeVisible()
  await owner.getByRole("button", { exact: true, name: "Versions" }).click()
  await owner.getByRole("listitem").filter({ hasText: "Checkpoint" }).getByRole("button", { name: "Restore" }).click()
  await expect(manager.getByText("Welcome aboard.", { exact: true })).toBeVisible()
  await expect(owner.getByRole("listitem").filter({ hasText: "Before going back to Checkpoint" })).toBeVisible()
})
