import { beforeEach, describe, expect, it } from "vitest"

import {
  clearLocalDraft,
  loadLocalDraft,
  saveLocalDraft,
} from "./draft-autosave"

describe("draft-autosave", () => {
  let store: Record<string, string> = {}

  beforeEach(() => {
    store = {}
    const mockStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value
      },
      removeItem: (key: string) => {
        delete store[key]
      },
      clear: () => {
        store = {}
      },
    }

    Object.defineProperty(globalThis, "window", {
      value: globalThis,
      writable: true,
      configurable: true,
    })

    Object.defineProperty(globalThis, "localStorage", {
      value: mockStorage,
      writable: true,
      configurable: true,
    })
  })

  it("saves and restores local draft data", () => {
    saveLocalDraft("test-key", { title: "Draft Title", value: "123" })

    const restored = loadLocalDraft<{ title: string; value: string }>("test-key")
    expect(restored).not.toBeNull()
    expect(restored?.data.title).toBe("Draft Title")
    expect(restored?.data.value).toBe("123")
  })

  it("clears local draft", () => {
    saveLocalDraft("test-key", { field: "data" })
    clearLocalDraft("test-key")

    const restored = loadLocalDraft("test-key")
    expect(restored).toBeNull()
  })

  it("expires old local drafts", () => {
    saveLocalDraft("expired-key", { old: "data" }, -1000)

    const restored = loadLocalDraft("expired-key")
    expect(restored).toBeNull()
  })
})
