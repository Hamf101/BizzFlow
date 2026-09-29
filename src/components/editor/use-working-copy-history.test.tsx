// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"

import type { LiveSession } from "@/lib/collaboration/live-session"

import { useWorkingCopyHistory } from "./use-working-copy-history"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Words = { words: string }

// A room's session that keeps whatever it is asked to become.
function fakeSession(start: Words): LiveSession<Words> & { made: Words[] } {
  let state = start
  const listeners = new Set<() => void>()
  const made: Words[] = []

  return {
    canRedo: () => false,
    canUndo: () => made.length > 0,
    catchUp: async () => undefined,
    change: (update) => {
      state = update(state)
      made.push(state)
      listeners.forEach((listener) => listener())
    },
    flush: async () => true,
    hear: () => undefined,
    made,
    redo: () => undefined,
    refresh: () => listeners.forEach((listener) => listener()),
    revision: () => 0,
    snapshot: () => state,
    status: () => "saved",
    stop: () => undefined,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    undo: vi.fn(),
  }
}

it("makes changes asked for before the room opened on the room's copy, even from a callback kept from then", async () => {
  const initial = { words: "Hello" }
  let history: ReturnType<typeof useWorkingCopyHistory<Words>> | null = null
  function Editor({ session }: { session: LiveSession<Words> | null }) {
    history = useWorkingCopyHistory(initial, session)
    return <p>{history.state.words}</p>
  }
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)

  act(() => root.render(<Editor session={null} />))
  // Typed before the room opened, and a picture still uploading then.
  act(() => history!.set((current) => ({ words: `${current.words}, world` })))
  const keptFromBefore = history!.set
  const session = fakeSession({ words: "Hello" })

  await act(async () => root.render(<Editor session={session} />))
  expect(session.made).toEqual([{ words: "Hello, world" }])
  expect(host.textContent).toBe("Hello, world")

  act(() => keptFromBefore((current) => ({ words: `${current.words}!` })))
  expect(session.made.at(-1)).toEqual({ words: "Hello, world!" })
  expect(host.textContent).toBe("Hello, world!")

  act(() => root.unmount())
  host.remove()
})

it("never shows the room's copy without what was typed before it opened, so the line being typed in stays put", async () => {
  const initial = { words: "" }
  const shown: string[] = []
  let history: ReturnType<typeof useWorkingCopyHistory<Words>> | null = null
  function Editor({ session }: { session: LiveSession<Words> | null }) {
    history = useWorkingCopyHistory(initial, session)
    shown.push(history.state.words)
    return <p>{history.state.words}</p>
  }
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)

  act(() => root.render(<Editor session={null} />))
  act(() => history!.set(() => ({ words: "Dea" })))
  shown.length = 0

  await act(async () => root.render(<Editor session={fakeSession({ words: "" })} />))
  // A moment on the room's bare copy would take the line away, and the caret with it.
  expect(shown).not.toContain("")
  expect(host.textContent).toBe("Dea")

  act(() => root.unmount())
  host.remove()
})
