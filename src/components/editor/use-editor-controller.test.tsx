// @vitest-environment jsdom
import { act, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { expect, it } from "vitest"

import { createTemplateBlock } from "@/components/templates/template-editor-state"
import { createEmptyDocumentContent, type TemplateBlock, type TemplateContentV3 } from "@/types/template"

import { type EditorController, useEditorController } from "./use-editor-controller"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it("keeps what a collaborator changed after this page drew, whatever is edited from what it drew", async () => {
  const field = { ...(createTemplateBlock("text_field") as Extract<TemplateBlock, { type: "text_field" }>), label: "Name" }
  const line: TemplateBlock = { alignment: "left", id: crypto.randomUUID(), text: "Hello", type: "paragraph" }
  const drawn: TemplateContentV3 = { ...createEmptyDocumentContent(), blocks: [field, line] }
  // The room's copy, where someone else renamed the field after this page drew.
  let room: TemplateContentV3 = { ...drawn, blocks: [{ ...field, label: "Full name" }, line] }
  let controller: EditorController | null = null

  function Editor(): null {
    const current = useEditorController({ change: (update) => (room = update(room)), content: drawn, undo: () => undefined })
    useEffect(() => {
      controller = current
    })
    return null
  }

  const root = createRoot(document.body.appendChild(document.createElement("div")))
  await act(async () => root.render(<Editor />))

  // The toolbar's Required switch, then the line moved above the field.
  act(() => controller!.updateBlock({ ...field, required: !field.required }))
  act(() => controller!.move(line.id, "up"))

  expect(room.blocks.map((block) => block.id)).toEqual([line.id, field.id])
  expect(room.blocks[1]).toMatchObject({ label: "Full name", required: !field.required })
  act(() => root.unmount())
})
