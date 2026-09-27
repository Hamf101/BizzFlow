import { expect, signInAs, test, uniqueName } from "../support/fixtures"
import { seedTenant } from "../support/tenant"

// PostgREST answers at most 1,000 rows per request (`max_rows`), so a listing
// that reads its documents in one request silently loses the rest.
const DOCUMENTS = 1_100

test("lists every document in a folder that holds more than one response's worth", async ({
  admin,
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  // Each run fills a tenant of its own. Every document insert takes its
  // tenant's folder-tree lock without waiting, and seeding this many into the
  // shared tenant held that lock long enough to fail other specs' writes.
  const tenant = await seedTenant(admin)
  const name = uniqueName("Archive boxes")
  const owner = tenant.users.owner_admin
  const { data: folder, error: folderError } = await admin
    .from("folders")
    .insert({
      created_by: owner.id,
      name,
      org_id: tenant.organizationId,
      updated_by: owner.id,
    })
    .select("id")
    .single()
  if (folderError) throw folderError

  const { error } = await admin.from("documents").insert(
    Array.from({ length: DOCUMENTS }, (_, index: number) => ({
      created_by: owner.id,
      folder_id: folder.id,
      org_id: tenant.organizationId,
      source_kind: "upload",
      title: `${name} ${String(index + 1).padStart(4, "0")}`,
      updated_by: owner.id,
    }))
  )
  if (error) throw error

  await signInAs(page, owner.email, owner.password)

  const started = Date.now()
  await page.goto(`/documents?folderId=${folder.id}`)
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    `Files ${DOCUMENTS} items`
  )
  console.log(
    `files-large-folder: ${DOCUMENTS} documents listed in ${Date.now() - started} ms (${testInfo.project.name})`
  )
  await expect(
    page.getByRole("link", { exact: true, name: `${name} ${DOCUMENTS}` })
  ).toHaveCount(1)

  // The same folder found by searching the whole view from the top of Files:
  // every document plus the folder itself, with access applied per row.
  const searched = Date.now()
  await page.goto(`/documents?q=${encodeURIComponent(name)}`)
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    `Files ${DOCUMENTS + 1} items`
  )
  console.log(
    `files-large-folder: ${DOCUMENTS} documents searched in ${Date.now() - searched} ms (${testInfo.project.name})`
  )
})
