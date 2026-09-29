import { describe, expect, it, vi } from "vitest"

import { broadcastSharingNotice, noticeTopic } from "@/services/documents/sharing-notice"

const NOTICE = {
  actorName: "Cara Creator",
  level: "viewer" as const,
  recipientUserId: "20000000-0000-4000-8000-000000000004",
  resource: { id: "40000000-0000-4000-8000-000000000001", kind: "document" as const },
  resourceName: "Lease",
}

describe("telling someone it was shared with them", () => {
  it("speaks only on the recipient's own channel", () => {
    expect(noticeTopic(NOTICE.recipientUserId)).toBe(`user:${NOTICE.recipientUserId}`)
  })

  it("sends what the toast needs and nothing else", async () => {
    const send = vi.fn(async () => undefined)

    await broadcastSharingNotice(NOTICE, send)

    expect(send).toHaveBeenCalledWith(`user:${NOTICE.recipientUserId}`, "shared", {
      actorName: "Cara Creator",
      id: NOTICE.resource.id,
      kind: "document",
      level: "viewer",
      name: "Lease",
    })
  })

  it("says how many items were shared at once", async () => {
    const send = vi.fn(async () => undefined)

    await broadcastSharingNotice({ ...NOTICE, count: 3 }, send)

    expect(send).toHaveBeenCalledWith(expect.any(String), "shared", expect.objectContaining({ count: 3 }))
  })

  it("lets the caller see a channel that would not take it", async () => {
    await expect(broadcastSharingNotice(NOTICE, async () => { throw new Error("no channel") })).rejects.toThrow("no channel")
  })
})
