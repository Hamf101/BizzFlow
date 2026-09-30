// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { describeShare, noticeSoundOn, playChime, readSharedMessage, setNoticeSound, watchNoticeSound } from "./sharing-notices"

const message = { actorName: "Maya", id: "d1", kind: "document", level: "viewer", name: "Lease" } as const

describe("readSharedMessage", () => {
  it("accepts what the server sends and nothing else", () => {
    expect(readSharedMessage(message)).toEqual(message)
    expect(readSharedMessage({ ...message, count: 3 })).toEqual({ ...message, count: 3 })
    expect(readSharedMessage({ ...message, count: "many" })).toEqual(message)
    expect(readSharedMessage({ ...message, kind: "template" })).toEqual({ ...message, kind: "template" })
    expect(readSharedMessage({ ...message, kind: "invoice" })).toBeNull()
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

  it("says how many when several were shared, and opens Files", () => {
    expect(describeShare({ ...message, count: 3 })).toEqual({
      detail: "You can view them.",
      href: "/documents",
      title: "Maya shared 3 items with you",
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

describe("describeShare for a template", () => {
  const template = { ...message, id: "t1", kind: "template", name: "Lease form" } as const

  it("opens an editor in the template's editor", () => {
    expect(describeShare({ ...template, level: "editor" })).toEqual({
      detail: "You can edit it.",
      href: "/templates/t1/edit",
      title: "Maya shared the template “Lease form” with you",
    })
  })

  it("opens the library for someone who can use or view it, and says which", () => {
    expect(describeShare({ ...template, level: "user" })).toMatchObject({ detail: "You can make documents from it.", href: "/templates" })
    expect(describeShare({ ...template, level: "viewer" })).toMatchObject({ detail: "You can view it.", href: "/templates" })
  })
})

describe("the chime", () => {
  const started = vi.fn()

  class FakeAudio {
    currentTime = 0
    destination = {}
    createOscillator = () => ({ connect: () => ({ connect: () => undefined }), frequency: {}, start: started, stop: () => undefined })
    createGain = () => ({ connect: () => ({ connect: () => undefined }), gain: { exponentialRampToValueAtTime: () => undefined, setValueAtTime: () => undefined } })
    close = async () => undefined
  }

  beforeEach(() => {
    started.mockClear()
    window.localStorage.clear()
    vi.stubGlobal("AudioContext", FakeAudio)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("sounds by default, and stays quiet once this device turns it off", () => {
    playChime()
    expect(started).toHaveBeenCalledTimes(2)

    setNoticeSound(false)
    expect(noticeSoundOn()).toBe(false)
    playChime()
    expect(started).toHaveBeenCalledTimes(2)

    setNoticeSound(true)
    playChime()
    expect(started).toHaveBeenCalledTimes(4)
  })

  it("tells a listener when the choice changes", () => {
    const heard = vi.fn()
    const stop = watchNoticeSound(heard)

    setNoticeSound(false)
    stop()
    setNoticeSound(true)

    expect(heard).toHaveBeenCalledTimes(1)
  })
})
