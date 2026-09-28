// @vitest-environment jsdom
import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, expect, it } from "vitest"

import { FieldGroupSettings } from "./field-group-settings"
import { useEditorController, type EditorController } from "./use-editor-controller"
import { useEditorHistory } from "./use-editor-history"
import { createEmptyDocumentContent, templateContentV3Schema, type TemplateContentV3 } from "@/types/template"

let root: Root
let controller: EditorController
const G = "70000000-0000-4000-8000-000000000021"
const field = (id: string, label: string) =>
  ({ fieldKey: label.toLowerCase(), helpText: null, id, label, multiline: false, placeholder: null, required: false, type: "text_field" }) as const
const ROW: TemplateContentV3 = {
  ...createEmptyDocumentContent(),
  blocks: [field("70000000-0000-4000-8000-000000000001", "Name"), field("70000000-0000-4000-8000-000000000002", "Date")],
  fieldGroups: [
    { columns: 2, endBlockId: "70000000-0000-4000-8000-000000000002", id: G, keepTogether: false, label: null, startBlockId: "70000000-0000-4000-8000-000000000001" },
  ],
}

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  act(() => root?.unmount())
  document.body.replaceChildren()
})

function Settings() {
  const history = useEditorHistory<TemplateContentV3>(ROW)
  const current = useEditorController({ change: history.set, content: history.state, undo: history.undo })
  useEffect(() => {
    controller = current
  })
  const group = current.content.fieldGroups[0]
  return group ? <FieldGroupSettings controller={current} group={group} /> : <p>No group</p>
}

// React listens for the input event and reads the value through its setter.
function type(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

it("labels a group of fields, keeps it on one page, and takes an emptied label away", async () => {
  root = createRoot(document.body.appendChild(document.createElement("div")))
  await act(async () => root.render(<Settings />))
  const label = document.getElementById(`${G}-group-label`) as HTMLInputElement
  const keep = document.getElementById(`${G}-group-keep`) as HTMLInputElement

  await act(async () => type(label, "Signed by"))
  await act(async () => keep.click())

  expect(controller.content.fieldGroups[0]).toMatchObject({ keepTogether: true, label: "Signed by" })
  expect(label.labels?.[0]?.textContent).toBe("Group label")
  expect(keep.labels?.[0]?.textContent).toBe("Keep the group on one page")

  await act(async () => type(label, ""))

  expect(controller.content.fieldGroups[0]?.label).toBeNull()
  expect(templateContentV3Schema.safeParse(controller.content).success).toBe(true)
})
