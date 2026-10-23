import { expect, it, vi } from "vitest"

import { cleanupAbandonedSigningAttachments } from "@/services/pdf-signing-service"
import { type FakeTables, PostgrestWriteQuery } from "@/services/postgrest-fake.test-support"

const NOW = new Date("2026-10-23T12:00:00.000Z")
const attachment = (id: string, status: string, createdAt: string) => ({
  created_at: createdAt,
  id,
  org_id: "10000000-0000-4000-8000-000000000001",
  status,
  storage_key: `organizations/o/documents/d/attachments/${id}`,
})

it("removes signer attachments never finished a day after their upload address lapsed, rows first, and nothing else", async () => {
  const tables: FakeTables = {
    document_signing_attachments: [
      attachment("abandoned", "upload_pending", "2026-10-21T12:00:00.000Z"),
      // Its upload address may still be open.
      attachment("recent", "upload_pending", "2026-10-23T11:50:00.000Z"),
      attachment("arrived", "available", "2026-10-20T12:00:00.000Z"),
    ],
  }
  const deleteObject = vi.fn<(input: { storageKey: string }) => Promise<void>>(async () => undefined)

  expect(await cleanupAbandonedSigningAttachments({ client: { from: (table: string) => new PostgrestWriteQuery(tables, table) } as never, deleteObject, now: () => NOW })).toEqual({
    failed: 0,
    removed: 1,
  })
  expect(deleteObject).toHaveBeenCalledWith({ storageKey: "organizations/o/documents/d/attachments/abandoned" })
  expect(tables.document_signing_attachments!.map((row) => row.id)).toEqual(["recent", "arrived"])
})
