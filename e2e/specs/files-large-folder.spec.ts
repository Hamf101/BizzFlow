import { expect, test, uniqueName } from "../support/fixtures"
import { retryConcurrentChange } from "../support/retry"

// PostgREST answers at most 1,000 rows per request (`max_rows`), so a listing
// that reads its documents in one request silently loses the rest.
const DOCUMENTS = 1_100

// Seeded a hundred at a time, so the tenant's folder-tree lock is held only
// briefly and other specs' inserts can pass between batches.
const SEED_BATCH = 100

test("lists every document in a folder that holds more than one response's worth", async ({
  admin,
  pageAs,
  tenant,
}, testInfo) => {
  test.setTimeout(120_000)
  // Each device project fills its own folder, so its count is exact.
  const name = uniqueName("Archive boxes")
  const owner = tenant.users.owner_admin
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

  const rows = Array.from({ length: DOCUMENTS }, (_, index: number) => ({
    created_by: owner.id,
    folder_id: folder.id,
    org_id: tenant.organizationId,
    source_kind: "upload",
    title: `${name} ${String(index + 1).padStart(4, "0")}`,
    updated_by: owner.id,
  }))
  for (let start = 0; start < rows.length; start += SEED_BATCH) {
    const { error } = await retryConcurrentChange(() =>
      admin.from("documents").insert(rows.slice(start, start + SEED_BATCH))
    )
    if (error) throw error
  }

  const page = await pageAs("owner_admin")
  if (testInfo.project.use.viewport) {
    await page.setViewportSize(testInfo.project.use.viewport)
  }

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
})
