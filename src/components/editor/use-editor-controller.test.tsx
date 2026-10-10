// @vitest-environment jsdom
import { Editor as LineEditor, Node } from "@tiptap/core"
import { act, useEffect } from "react"
import { expect, it } from "vitest"

import { createTemplateBlock } from "@/components/templates/template-editor-state"
import { createEmptyDocumentContent, type TemplateBlock, type TemplateContentV3 } from "@/types/template"

import { type EditorController, useEditorController } from "./use-editor-controller"
import { mount } from "@/test/render"

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

  const root = mount()
  await act(async () => root.render(<Editor />))

  // The toolbar's Required switch, then the line moved above the field.
  act(() => controller!.updateBlock({ ...field, required: !field.required }))
  act(() => controller!.move(line.id, "up"))

  expect(room.blocks.map((block) => block.id)).toEqual([line.id, field.id])
  expect(room.blocks[1]).toMatchObject({ label: "Full name", required: !field.required })
  act(() => root.unmount())
})

it("lets go of a line whose editor is gone when another block is chosen", async () => {
  const field = createTemplateBlock("text_field")
  const content: TemplateContentV3 = { ...createEmptyDocumentContent(), blocks: [field] }
  let controller: EditorController | null = null

  function Editor(): null {
    const current = useEditorController({ change: () => undefined, content, undo: () => undefined })
    useEffect(() => {
      controller = current
    })
    return null
  }

  const root = mount()
  await act(async () => root.render(<Editor />))
  // The caret's line was replaced by a block (a / command), so its editor no longer has a view.
  const gone = new LineEditor({
    extensions: [Node.create({ content: "text*", name: "doc", topNode: true }), Node.create({ group: "inline", name: "text" })],
  })
  gone.unmount()
  act(() => controller!.setLine(gone))

  act(() => controller!.select(field.id))

  expect(controller!.line).toBeNull()
  act(() => root.unmount())
  gone.destroy()
})
