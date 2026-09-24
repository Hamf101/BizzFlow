import { expect, test, uniqueName } from "../support/fixtures"
import { retryConcurrentChange } from "../support/retry"
import { seedTemplate } from "../support/seed"

test("switches Files between Finder's views, remembers the choice, and follows the chosen document", async ({
  admin,
  pageAs,
  tenant,
}, testInfo) => {
  // Each device project fills its own folder in the shared tenant.
  const name = uniqueName("Lettings")
  const lease = `${name} lease`
  const owner = tenant.users.owner_admin
  const template = await seedTemplate(
    admin,
    tenant.organizationId,
    `${name} template`,
    "published"
  )
  const { data: folder, error: folderError } = await retryConcurrentChange(() =>
    admin
      .from("folders")
      .insert({
        created_by: owner.id,
        name,
        org_id: tenant.organizationId,
        updated_by: owner.id,
      })
      .select("id")
      .single()
  )
  if (folderError) throw folderError

  const { data: rows, error } = await retryConcurrentChange(() =>
    admin
      .from("documents")
      .insert([
      {
        created_by: owner.id,
        folder_id: folder.id,
        org_id: tenant.organizationId,
        source_kind: "generated",
        template_id: template.id,
        template_revision: 1,
        template_snapshot: template.content,
        title: lease,
      },
      {
        created_by: owner.id,
        folder_id: folder.id,
        org_id: tenant.organizationId,
        source_kind: "upload",
        title: `${name} scan.pdf`,
      },
    ])
      .select("id,source_kind")
  )
  if (error) throw error
  const leaseId = rows.find((row) => row.source_kind === "generated")?.id

  const { error: answersError } = await admin.from("document_answers").insert({
    document_id: leaseId,
    org_id: tenant.organizationId,
    workflow_status: "awaiting_signatures",
  })
  if (answersError) throw answersError

  const page = await pageAs("owner_admin")
  const viewport = testInfo.project.use.viewport
  if (viewport) {
    await page.setViewportSize(viewport)
  }
  const layoutButton = (label: string) =>
    page.getByRole("button", { exact: true, name: `${label} view` })
  const expectLayout = async (label: string): Promise<void> => {
    await expect(layoutButton(label)).toHaveAttribute("aria-pressed", "true")
  }

  await page.goto(`/documents?folderId=${folder.id}`)

  // A new person starts in Icons, where the document shows its page and status.
  await expectLayout("Icons")
  const tile = page
    .locator('[data-slot="file-tile"]')
    .filter({ has: page.getByRole("link", { exact: true, name: lease }) })
  await expect(tile.locator('[data-slot="template-page"]')).toBeVisible()
  await expect(tile).toContainText("Awaiting signatures")

  if ((viewport?.width ?? 1280) < 768) {
    // A phone offers Icons and List only.
    await expect(layoutButton("Columns")).toBeHidden()
    await layoutButton("List").click()
    await expectLayout("List")
    await page.reload()
    await expectLayout("List")
    return
  }

  await layoutButton("Columns").click()
  await expectLayout("Columns")
  await page
    .locator('[data-slot="file-columns"]')
    .getByRole("link", { name: lease })
    .click()
  const preview = page.locator('[data-slot="file-preview"]')
  await expect(preview.getByRole("heading", { name: lease })).toBeVisible()
  await expect(preview).toContainText("Awaiting signatures")

  // The chosen document follows the person into Gallery.
  await layoutButton("Gallery").click()
  await expectLayout("Gallery")
  await expect(
    page.locator('[data-slot="file-gallery"]').getByRole("heading", { name: lease })
  ).toBeVisible()

  await layoutButton("List").click()
  await expectLayout("List")
  await page.reload()
  await expectLayout("List")
  await expect(page.getByRole("link", { exact: true, name: lease })).toBeVisible()
})
