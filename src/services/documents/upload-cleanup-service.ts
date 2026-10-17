import { deleteDocumentStorageObject } from "@/services/document-storage-service"
import type { DocumentServiceClient } from "@/services/documents/contracts"
import { getClient } from "@/services/documents/shared"

/** Uploads stay claimable this long after their signed URL expires. */
const GRACE_MS = 24 * 60 * 60 * 1_000
const BATCH = 100

type AbandonedVersion = { document_id: string; id: string; org_id: string; storage_key: string; version_number: number }

export type CleanupAbandonedDocumentUploadsDeps = {
  client?: DocumentServiceClient
  now?: () => Date
  deleteDocumentStorageObject?: (input: { storageKey: string }) => Promise<void>
}

/**
 * Removes uploads nobody finished: a version still pending a day after its
 * upload URL expired loses its bytes, if any arrived, then its row; a document
 * that was nothing but that first version goes with it. Bytes go first, so a
 * failure leaves the rows for the next run to try again.
 *
 * @param deps - Optional database, clock and storage dependencies for tests.
 * @returns How many uploads were removed, and how many could not be.
 */
export async function cleanupAbandonedDocumentUploads(
  deps: CleanupAbandonedDocumentUploadsDeps = {}
): Promise<{ failed: number; removed: number }> {
  const client = getClient(deps)
  const cutoff = new Date((deps.now ?? (() => new Date()))().getTime() - GRACE_MS).toISOString()
  const deleteObject = deps.deleteDocumentStorageObject ?? deleteDocumentStorageObject
  // tenant-scope: a scheduled sweep across every workspace; each row's own org_id scopes its deletes
  const { data, error } = await client
    .from("document_versions")
    .select("id,org_id,document_id,storage_key,version_number")
    .eq("status", "upload_pending")
    .lt("upload_authorization_expires_at", cutoff)
    .limit(BATCH)

  if (error) {
    throw new Error(`Unable to list abandoned uploads: ${error.message}`)
  }

  let removed = 0
  let failed = 0

  for (const version of (data ?? []) as AbandonedVersion[]) {
    try {
      await deleteObject({ storageKey: version.storage_key })
      // Only while still pending: one finished meanwhile is kept.
      const gone = await client
        .from("document_versions")
        .delete()
        .eq("id", version.id)
        .eq("org_id", version.org_id)
        .eq("status", "upload_pending")

      if (gone.error) {
        throw gone.error
      }

      if (version.version_number === 1) {
        const empty = await client
          .from("documents")
          .delete()
          .eq("id", version.document_id)
          .eq("org_id", version.org_id)
          .is("current_version_id", null)

        if (empty.error) {
          throw empty.error
        }
      }

      removed += 1
    } catch (cause: unknown) {
      failed += 1
      console.error("document_upload_cleanup_failed", { organizationId: version.org_id, versionId: version.id, cause: String(cause) })
    }
  }

  return { failed, removed }
}
