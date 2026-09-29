import { describe, expect, it } from "vitest"

import { describeShare, readSharedMessage } from "./sharing-notices"

const message = { actorName: "Maya", id: "d1", kind: "document", level: "viewer", name: "Lease" } as const

describe("readSharedMessage", () => {
  it("accepts what the server sends and nothing else", () => {
    expect(readSharedMessage(message)).toEqual(message)
    expect(readSharedMessage({ ...message, kind: "template" })).toBeNull()
    expect(readSharedMessage({ ...message, name: 4 })).toBeNull()
    expect(readSharedMessage(null)).toBeNull()
  })
})

describe("describeShare", () => {
  it("says who shared what and opens a document in the editor", () => {
    expect(describeShare(message)).toEqual({
      detail: "You can view it.",
      href: "/documents/d1",
      title: "Maya shared “Lease” with you",
    })
  })

  it("opens a folder in Files, and says when the person can edit", () => {
    expect(describeShare({ ...message, id: "f1", kind: "folder", level: "contributor" })).toEqual({
      detail: "You can edit it.",
      href: "/documents?folderId=f1",
      title: "Maya shared the folder “Lease” with you",
    })
  })
})
