import { randomUUID } from "node:crypto"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"

test("a published template's edits are kept as they're made, reach staff on Update, and an old version comes back as an edit", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const terms = { alignment: "left", id: randomUUID(), text: "Pay within 30 days.", type: "paragraph" }
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Payment terms"), "published", [terms])
  const page = await pageAs("owner_admin")
  const text = (relation: string) =>
    expect.poll(
      async () => {
        const { data, error } = await admin.from(relation).select("content").eq("id", template.id).single()
        if (error) throw error
        return data.content.blocks.map((block: { text?: string }) => block.text)
      },
      { timeout: 15_000 }
    )
  const update = page.getByRole("button", { exact: true, name: "Update" })
  const save = page.getByRole("button", { exact: true, name: "Save" })
  const opened = page.waitForResponse((response) => response.url().endsWith(`/api/templates/${template.id}/room`))

  await page.goto(`/templates/${template.id}/edit`)
  await waitForHydration(update)
  await opened
  await expect(update).toBeDisabled()
  await expect(save).toBeHidden()

  // An edit is kept as it is made, with nothing to save by hand; staff still get what was published.
  await page.getByText("Pay within 30 days.").click({ clickCount: 3 })
  await page.keyboard.type("Pay within 14 days.")
  await text("document_templates").toEqual(["Pay within 14 days."])
  await text("published_document_templates").toEqual(["Pay within 30 days."])
  await expect(save).toBeHidden()
  await expect(update).toBeEnabled()
  await page.reload()
  await waitForHydration(update)
  await expect(page.getByText("Pay within 14 days.")).toBeVisible()

  // A document started now copies the published version.
  await page.goto("/documents/new")
  const create = page.getByRole("button", { exact: true, name: "Create" })
  await waitForHydration(create)
  await create.click()
  const dialog = page.getByRole("dialog", { name: "Create document" })
  await dialog.getByLabel("Template").click()
  await page.getByRole("option", { exact: true, name: template.title }).click()
  await dialog.getByLabel("Title").fill(uniqueName("Supplier terms"))
  await dialog.getByRole("button", { name: "Create" }).click()
  await page.waitForURL(/\/documents\/[0-9a-f-]+\/edit/)
  const documentPath = new URL(page.url()).pathname
  await expect(page.getByText("Pay within 30 days.")).toBeVisible()

  // Update publishes the working copy; the document keeps what it copied.
  await page.goto(`/templates/${template.id}/edit`)
  await waitForHydration(update)
  await update.click()
  await expect(page.getByText("Template updated")).toBeVisible()
  await text("published_document_templates").toEqual(["Pay within 14 days."])
  await expect(update).toBeDisabled()
  await page.goto(documentPath)
  await expect(page.getByText("Pay within 30 days.")).toBeVisible()

  // The first version comes back into the working copy, not onto what staff get.
  await page.goto(`/templates/${template.id}/edit`)
  await waitForHydration(update)
  await page.getByRole("button", { exact: true, name: "Versions" }).click()
  const versions = page.locator('[data-slot="template-versions"] li')
  await expect(versions).toHaveCount(2)
  await expect(versions.first()).toContainText("Live")
  await versions.nth(1).getByRole("button", { name: "Restore" }).click()
  await expect(page.getByText("Pay within 30 days.")).toBeVisible()
  await text("document_templates").toEqual(["Pay within 30 days."])
  await text("published_document_templates").toEqual(["Pay within 14 days."])

  // Update publishes it as a version of its own.
  await update.click()
  await expect(page.getByText("Template updated")).toBeVisible()
  await text("published_document_templates").toEqual(["Pay within 30 days."])

  // Nothing, not even the service role, rewrites a published version.
  const { error: rewrite } = await admin
    .from("document_template_versions")
    .update({ title: "Rewritten" })
    .eq("template_id", template.id)
  const { error: removal } = await admin.from("document_template_versions").delete().eq("template_id", template.id)
  const { data: kept, error } = await admin
    .from("document_template_versions")
    .select("content")
    .eq("template_id", template.id)
    .order("revision")
  if (error) throw error

  expect([rewrite?.code, removal?.code]).toEqual(["42501", "42501"])
  expect(kept.map(({ content }) => content.blocks[0].text)).toEqual([
    "Pay within 30 days.",
    "Pay within 14 days.",
    "Pay within 30 days.",
  ])
})
