// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, expect, it } from "vitest"

import { type SaveResult, useAutosave } from "@/components/editor/use-autosave"

const roots: Root[] = []

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.replaceChildren()
})

it("never sends one version twice, however many saves are asked for at once", async () => {
  const attempts: Array<{ value: string; version: string }> = []
  const waiting: Array<() => void> = []
  const save = async (value: string, version: string): Promise<SaveResult> => {
    attempts.push({ value, version })
    await new Promise<void>((resolve) => waiting.push(resolve))
    return { ok: true, version: String(attempts.length + 1) }
  }
  let controls: { flush: () => Promise<boolean> } | null = null

  function Editor({ value }: { value: string }): null {
    const autosave = useAutosave({ delay: 5, enabled: true, initialVersion: "1", save, value })
    controls = autosave
    return null
  }

  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(<Editor value="first" />))

  // One save is in flight, the page changes again, and two savers ask at
  // once: the sender flushing and the timer that was already waiting.
  await act(async () => root.render(<Editor value="second" />))
  const inFlight = controls!.flush()
  await act(async () => root.render(<Editor value="third" />))
  const sender = controls!.flush()
  const timer = controls!.flush()

  await act(async () => {
    waiting.shift()?.()
    await inFlight
  })
  await act(async () => {
    waiting.splice(0).forEach((resolve) => resolve())
    await Promise.all([sender, timer])
  })

  expect(attempts.map((attempt) => attempt.value)).toEqual(["second", "third"])
  expect(new Set(attempts.map((attempt) => attempt.version)).size).toBe(attempts.length)
})
