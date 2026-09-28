// @vitest-environment jsdom
import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, expect, it } from "vitest"

import { INSERT_CHOICES } from "./block-catalog"
import { EditorCanvas } from "./editor-canvas"
import { useEditorController, type EditorController } from "./use-editor-controller"
import { useEditorHistory } from "./use-editor-history"
import { createEmptyDocumentContent, templateContentV3Schema, type TemplateContentV3 } from "@/types/template"

let root: Root
let controller: EditorController
const S = "70000000-0000-4000-8000-000000000011"
const B = "70000000-0000-4000-8000-000000000002"
beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
})
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren() })

function Canvas({ editable = true, narrow = true }: { editable?: boolean; narrow?: boolean }) {
  const history = useEditorHistory<TemplateContentV3>({
    ...createEmptyDocumentContent(),
    blocks: [{ id: B, type: "paragraph" as const, alignment: "left" as const, text: "Pay monthly." }],
    sections: [{ id: S, label: "Terms", startBlockId: B, keepTogether: false, pageBreakBefore: false }],
  })
  const current = useEditorController({ change: history.set, content: history.state, undo: history.undo })
  useEffect(() => { controller = current })
  return <EditorCanvas allowFiles controller={current} designable={editable} documentTitle="Agreement" fields="design" narrow={narrow} surface="screen" textEditable={editable} zoom={1} />
}

it("edits section titles, keeps an emptied title valid, switches rules and moves the caret into its text", async () => {
  root = createRoot(document.body.appendChild(document.createElement("div")))
  await act(async () => root.render(<Canvas />))
  const title = document.querySelector<HTMLElement>('[aria-label="Section title"]')
  expect(title).not.toBeNull()
  await act(async () => { title!.focus(); title!.textContent = "Payment terms"; title!.dispatchEvent(new InputEvent("input", { bubbles: true })) })
  expect(controller.content.sections[0]?.label).toBe("Payment terms")
  const press = (name: string) => act(() => (document.querySelector(`[aria-label="${name}"]`) as HTMLButtonElement).click())
  press("Keep on one page")
  press("Start on a new page")
  expect(controller.content.sections[0]).toMatchObject({ keepTogether: true, pageBreakBefore: true })
  await act(async () => { title!.textContent = ""; title!.dispatchEvent(new InputEvent("input", { bubbles: true })); title!.blur() })
  expect(templateContentV3Schema.safeParse(controller.content).success).toBe(true)
  expect(title!.textContent).toBe("Payment terms")
  await act(async () => title!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })))
  expect(controller.activeBlockId).toBe(B)
  expect(document.activeElement?.getAttribute("data-caret-key")).toBe(B)
})

it("shows section titles without editing controls or decorative pieces in preview", async () => {
  root = createRoot(document.body.appendChild(document.createElement("div")))
  await act(async () => root.render(<Canvas editable={false} />))
  expect(document.body.textContent).toContain("Terms")
  expect(document.querySelector('[aria-label="Section title"]')).toBeNull()
  expect(document.querySelector('[data-slot="section-pieces"]')).toBeNull()
})

it("pairs fields through the block toolbar and toggles keep-with-next on the saved content", async () => {
  root = createRoot(document.body.appendChild(document.createElement("div")))
  await act(async () => root.render(<Canvas />))
  const choice = INSERT_CHOICES.find((choice) => choice.id === "text-field")!
  await act(async () => controller.insert(choice))
  const first = controller.content.blocks.at(-1)!.id
  await act(async () => controller.insert(choice))
  const second = controller.content.blocks.at(-1)!.id
  const press = (name: string) => act(() => (document.querySelector(`[aria-label="${name}"]`) as HTMLButtonElement).click())
  press("Side by side")
  expect(controller.content.fieldGroups).toMatchObject([{ columns: 2, startBlockId: first, endBlockId: second }])
  await act(async () => controller.select(first))
  press("Keep with next")
  expect(controller.content.blockRules).toContainEqual({ blockId: first, keepWithNext: true, pageBreakBefore: false })
  press("Side by side")
  expect(controller.content.fieldGroups).toEqual([])
  expect(templateContentV3Schema.safeParse(controller.content).success).toBe(true)
})

it("keeps the active section pieces when the canvas switches from desktop to phone", async () => {
  root = createRoot(document.body.appendChild(document.createElement("div")))
  await act(async () => root.render(<Canvas narrow={false} />))
  await act(async () => controller.setActiveBlockId(B))
  expect(document.querySelector('[data-slot="section-pieces"]')).not.toBeNull()
  await act(async () => root.render(<Canvas narrow />))
  expect(document.querySelector('[data-slot="section-pieces"]')).not.toBeNull()
})
