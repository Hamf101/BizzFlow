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

it("takes back the document an upload stopped partway made, so nothing unopenable is left in Files", async () => {
  const requests: Array<{ body?: string; method?: string; url: string }> = []

  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    requests.push({ body: init.body as string | undefined, method: init.method, url })

    // The document is made; the bytes are still on their way when the chip is removed.
    return url === "/api/documents/upload-url"
      ? Promise.resolve(new Response(JSON.stringify({ documentId: "50000000-0000-4000-8000-000000000001", uploadUrl: "https://r2.example/put", versionId: "v" })))
      : init.method === "PUT"
        ? new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))
        : Promise.resolve(new Response("{}"))
  })

  const { attachment } = await attached()

  await act(async () => attachment().clear())

  expect(requests.at(-1)).toEqual({
    body: JSON.stringify({ organizationId: "10000000-0000-4000-8000-000000000001" }),
    method: "DELETE",
    url: "/api/documents/50000000-0000-4000-8000-000000000001/complete-upload",
  })
})
