// @vitest-environment jsdom

import { act } from "react"
import type { Root } from "react-dom/client"
import { expect, it } from "vitest"

import { type SaveResult, useAutosave } from "@/components/editor/use-autosave"
import { useLocalRecovery } from "@/components/editor/use-local-recovery"
import { clearLocalDraft, loadLocalDraft } from "@/lib/draft-autosave"
import { mount } from "@/test/render"

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
    // Longer than the test may run, so only the flushes below ever save. At
    // 5 ms a loaded machine let the timer save first and hang the test.
    const autosave = useAutosave({ delay: 60_000, enabled: true, initialVersion: "1", save, value })
    controls = autosave
    return null
  }

  const root = mount()
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

it("saves the last edit to the server and to this device when the editor closes", async () => {
  const sent: string[] = []
  const save = async (value: string): Promise<SaveResult> => {
    sent.push(value)
    return { ok: true, version: "2" }
  }

  function Editor({ value }: { value: string }): null {
    useAutosave({ delay: 60_000, enabled: true, initialVersion: "1", save, value })
    useLocalRecovery({ key: "closing", saved: "first", value, version: "1" })
    return null
  }

  const root = mount()
  await act(async () => root.render(<Editor value="first" />))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 5)))
  await act(async () => root.render(<Editor value="second" />))
  await act(async () => root.unmount())

  expect(sent).toEqual(["second"])
  expect(JSON.stringify(loadLocalDraft("closing")?.data)).toContain("second")
  clearLocalDraft("closing")
})

it("never offers a copy kept on this device over newer work on the server", async () => {
  let offered: unknown = "unset"

  function Editor({ value, version }: { value: string; version: string }): null {
    offered = useLocalRecovery({ key: "older", saved: "server", value, version }).recovery
    return null
  }

  async function open(value: string, version: string): Promise<Root> {
    const root = mount()
    await act(async () => root.render(<Editor value={value} version={version} />))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)))
    return root
  }

  async function keepMineOnVersionOne(): Promise<void> {
    const root = await open("server", "1")
    await act(async () => root.render(<Editor value="mine" version="1" />))
    await act(async () => root.unmount())
  }

  // Kept on top of version 1, then someone saved version 2.
  await keepMineOnVersionOne()
  await open("server", "2")
  expect(offered).toBeNull()

  // The same copy over the version it was made on is offered.
  await keepMineOnVersionOne()
  await open("server", "1")
  expect(offered).not.toBeNull()
})
