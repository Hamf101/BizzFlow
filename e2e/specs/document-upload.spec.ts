import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"

test("uploads a chosen file under the title its name suggested, once confirmed", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const page = await pageAs("owner_admin")
  const title = uniqueName("Gas safety certificate")

  await page.goto("/documents/new")
  const upload = page.getByLabel("Upload", { exact: true })
  await waitForHydration(upload)

  // Choosing the file comes first; the title is asked for after.
  await upload.setInputFiles({
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
    mimeType: "application/pdf",
    name: "Gas safety certificate.pdf",
  })
  const dialog = page.getByRole("dialog", { name: "Upload document" })
  const titleField = dialog.getByLabel("Title")
  await expect(titleField).toHaveValue("Gas safety certificate")

  await titleField.fill(title)
  await dialog.getByRole("button", { name: "Upload" }).click()

  await expect(page.getByRole("heading", { name: title })).toBeVisible({
    timeout: 30_000,
  })
  // Two reads: documents and versions are joined both ways, so an embedded
  // select would be ambiguous.
  const document = await admin
    .from("documents")
    .select("id")
    .eq("org_id", tenant.organizationId)
    .eq("title", title)
    .single()
  if (document.error) throw document.error
  const versions = await admin
    .from("document_versions")
    .select("original_filename")
    .eq("document_id", document.data.id)
  if (versions.error) throw versions.error
  expect(versions.data).toEqual([{ original_filename: "Gas safety certificate.pdf" }])
})
