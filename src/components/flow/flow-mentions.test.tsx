// @vitest-environment jsdom

import { act } from "react"
import { expect, it, vi } from "vitest"

import { FlowPicker, parseFlowLink } from "@/components/flow/flow-mentions"
import { mount } from "@/test/render"

const ORIGIN = "https://app.bizflow.test"
const ID = "77000000-0000-4000-8000-000000000001"

it("reads a link to something in BizFlow as a mention, and nothing else", () => {
  expect(parseFlowLink(`${ORIGIN}/templates/${ID}/edit`, ORIGIN)).toEqual({ id: ID, kind: "templates" })
  expect(parseFlowLink(`${ORIGIN}/documents/${ID}`, ORIGIN)).toEqual({ id: ID, kind: "files" })
  expect(parseFlowLink(`/submissions/${ID}?tab=answers`, ORIGIN)).toEqual({ id: ID, kind: "submissions" })
  expect(parseFlowLink(` ${ORIGIN}/tasks/${ID} `, ORIGIN)).toEqual({ id: ID, kind: "tasks" })
  // Another site, a page that isn't one item, or no id at all.
  expect(parseFlowLink(`https://evil.example/templates/${ID}`, ORIGIN)).toBeNull()
  expect(parseFlowLink(`${ORIGIN}/templates`, ORIGIN)).toBeNull()
  expect(parseFlowLink(`${ORIGIN}/templates/new`, ORIGIN)).toBeNull()
  expect(parseFlowLink("just some words", ORIGIN)).toBeNull()
})

it("offers only the files Flow can read when picking one from Files", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("fetch", vi.fn(async () =>
    Response.json({
      hits: [
        { item: { id: ID, sourceKind: "upload", title: "Intake.pdf" }, kind: "files" },
        { item: { id: "77000000-0000-4000-8000-000000000003", sourceKind: "generated", title: "Signed agreement" }, kind: "files" },
      ],
    })
  ))

  await act(async () => mount().render(<FlowPicker onOpenChange={() => undefined} onPick={() => undefined} only="files" open />))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })

  const listed = [...document.querySelectorAll('[role="dialog"] li')].map((entry) => entry.textContent)
  expect(listed).toEqual(["Intake.pdfFile"])
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
