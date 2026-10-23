import { SIGNED_URL_MAX_TTL_SECONDS } from "@/lib/r2/stored-file"
import type { SigningServiceClient } from "@/services/document-signing/contracts"
import { resolveSigningClient } from "@/services/document-signing/persistence"
import { deleteDocumentStorageObject } from "@/services/document-storage-service"

/** An attachment stays claimable a day after its upload address can last. */
const ABANDONED_AFTER_MS = (SIGNED_URL_MAX_TTL_SECONDS + 24 * 60 * 60) * 1_000
const BATCH = 100

export type CleanupAbandonedSigningAttachmentsDeps = {
  client?: SigningServiceClient
  deleteObject?: (input: { storageKey: string }) => Promise<void>
  now?: () => Date
}

/**
 * Removes what signers began to attach and never finished: an attachment
 * still pending a day after its upload address lapsed loses its row, then its
 * bytes if any arrived. The row goes first, and only while still pending, so
 * one confirmed meanwhile keeps its file.
 *
 * @param deps - Optional database, storage and clock for tests.
 * @returns How many were removed, and how many could not be.
 */
export async function cleanupAbandonedSigningAttachments(
  deps: CleanupAbandonedSigningAttachmentsDeps = {}
): Promise<{ failed: number; removed: number }> {
  const client = resolveSigningClient(deps.client)
  const cutoff = new Date((deps.now ?? (() => new Date()))().getTime() - ABANDONED_AFTER_MS).toISOString()
  const deleteObject = deps.deleteObject ?? deleteDocumentStorageObject
  // tenant-scope: a scheduled sweep across every workspace; each row's own org_id scopes its delete
  const { data, error } = await client
    .from("document_signing_attachments")
    .select("id,org_id,storage_key")
    .eq("status", "upload_pending")
    .lt("created_at", cutoff)
    .limit(BATCH)

  if (error) {
    throw new Error(`Unable to list abandoned signing attachments: ${error.message}`)
  }

  let removed = 0
  let failed = 0

  for (const attachment of (data ?? []) as Array<{ id: string; org_id: string; storage_key: string }>) {
    try {
      const gone = await client
        .from("document_signing_attachments")
        .delete()
        .eq("id", attachment.id)
        .eq("org_id", attachment.org_id)
        .eq("status", "upload_pending")
        .select("id")

      if (gone.error) {
        throw gone.error
      }

      if (!gone.data?.length) {
        continue
      }

      // ponytail: a failed delete orphans private bytes (logged below); a retry queue if that ever adds up
      await deleteObject({ storageKey: attachment.storage_key })
      removed += 1
    } catch (cause: unknown) {
      failed += 1
      console.error("signing_attachment_cleanup_failed", { attachmentId: attachment.id, organizationId: attachment.org_id, cause: String(cause) })
    }
  }

  return { failed, removed }
}
