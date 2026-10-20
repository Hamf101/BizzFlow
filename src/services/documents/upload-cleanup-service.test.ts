import { describe, expect, it, vi } from "vitest"

import { cleanupAbandonedDocumentUploads } from "@/services/document-service"
import { createDocumentRow, createVersionRow, FakeSupabaseClient } from "@/services/document-service.test-support"

const NOW = new Date("2026-10-17T12:00:00.000Z")
const LONG_AGO = "2026-10-15T12:00:00.000Z"
const AN_HOUR_AGO = "2026-10-17T11:00:00.000Z"

function seed() {
  return new FakeSupabaseClient({
    documents: [
      // Never uploaded: the document is nothing but its abandoned first version.
      createDocumentRow({ id: "empty", current_version_id: null }),
      // Has a version; an abandoned second one goes, the document stays.
      createDocumentRow({ id: "kept", current_version_id: "kept-1" }),
      // Its upload window closed only an hour ago: someone may still finish it.
      createDocumentRow({ id: "recent", current_version_id: null }),
    ],
    document_versions: [
      createVersionRow({ id: "empty-1", document_id: "empty", status: "upload_pending", upload_authorization_expires_at: LONG_AGO, storage_key: "k/empty-1" }),
      createVersionRow({ id: "kept-1", document_id: "kept", status: "available", storage_key: "k/kept-1" }),
      createVersionRow({ id: "kept-2", document_id: "kept", version_number: 2, status: "upload_pending", upload_authorization_expires_at: LONG_AGO, storage_key: "k/kept-2" }),
      createVersionRow({ id: "recent-1", document_id: "recent", status: "upload_pending", upload_authorization_expires_at: AN_HOUR_AGO, storage_key: "k/recent-1" }),
    ],
  })
}

describe("cleanupAbandonedDocumentUploads", () => {
  it("removes the bytes and rows of uploads abandoned over a day ago, and nothing else", async () => {
    const client = seed()
    const deleteDocumentStorageObject = vi.fn<(input: { storageKey: string }) => Promise<void>>(async () => {})

    await expect(cleanupAbandonedDocumentUploads({ client: client as never, now: () => NOW, deleteDocumentStorageObject })).resolves.toEqual({
      removed: 2,
      failed: 0,
    })

    expect(deleteDocumentStorageObject.mock.calls.map(([input]) => input.storageKey).sort()).toEqual(["k/empty-1", "k/kept-2"])
    expect(client.tables.documents.map((row) => row.id).sort()).toEqual(["kept", "recent"])
    expect(client.tables.document_versions.map((row) => row.id).sort()).toEqual(["kept-1", "recent-1"])
  })

  it("keeps an upload completed after the sweep listed it, bytes and all", async () => {
    const client = seed()
    const from = client.from.bind(client)
    let versionQueries = 0
    // The second document_versions query is the claim on empty-1: it completes just before.
    client.from = ((table: Parameters<typeof from>[0]) => {
      if (table === "document_versions" && versionQueries++ === 1) {
        Object.assign(client.tables.document_versions.find((row) => row.id === "empty-1")!, { status: "available" })
      }
      return from(table)
    }) as typeof client.from
    const deleteDocumentStorageObject = vi.fn<(input: { storageKey: string }) => Promise<void>>(async () => {})

    await expect(cleanupAbandonedDocumentUploads({ client: client as never, now: () => NOW, deleteDocumentStorageObject })).resolves.toEqual({
      removed: 1,
      failed: 0,
    })
    expect(deleteDocumentStorageObject.mock.calls.map(([input]) => input.storageKey)).toEqual(["k/kept-2"])
    expect(client.tables.document_versions.map((row) => row.id).sort()).toEqual(["empty-1", "kept-1", "recent-1"])
  })
})
