// @vitest-environment jsdom

import { act, type ReactElement } from "react"
import { afterEach, expect, it, vi } from "vitest"

import { type FlowAttachment, useFlowAttachment } from "@/components/flow/flow-attach"
import { mount } from "@/test/render"

afterEach(() => {
  vi.unstubAllGlobals()
})

// Every request the upload makes waits until its signal stops it.
function stubUploads(): AbortSignal[] {
  const signals: AbortSignal[] = []

  vi.stubGlobal("fetch", (_url: string, init: RequestInit = {}) => {
    signals.push(init.signal!)

    return new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))
  })

  return signals
}

async function attached(): Promise<{ attachment: () => FlowAttachment; root: ReturnType<typeof mount> }> {
  let current: FlowAttachment | null = null

  function Probe(): ReactElement | null {
    current = useFlowAttachment("10000000-0000-4000-8000-000000000001")
    return null
  }

  const root = mount()
  await act(async () => root.render(<Probe />))
  await act(async () => current!.attach(new File(["%PDF-1.7"], "Intake.pdf", { type: "application/pdf" })))

  return { attachment: () => current!, root }
}

it("stops a form's upload when its chip is removed, or Flow goes away, and refuses nothing it didn't send", async () => {
  const signals = stubUploads()
  const first = await attached()

  expect(first.attachment().uploading).toBe(true)
  expect(signals).toHaveLength(1)
  expect(signals[0]!.aborted).toBe(false)

  await act(async () => first.attachment().clear())

  expect(signals[0]!.aborted).toBe(true)
  expect(first.attachment().chip).toBeNull()
  // Stopped on purpose, so nothing is said about it.
  expect(first.attachment().error).toBeNull()

  const second = await attached()

  await act(async () => second.root.unmount())

  expect(signals[1]!.aborted).toBe(true)
})
