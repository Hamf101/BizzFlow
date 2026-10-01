// @vitest-environment jsdom
import { act, useEffect, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, expect, it } from "vitest"

import { parseGeneratedDocumentAnswers } from "@/components/documents/generated-document-form-data"

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

const TERMS: TemplateContentV3 = {
  ...createEmptyDocumentContent(),
  blocks: [{ id: B, type: "paragraph" as const, alignment: "left" as const, text: "Pay monthly." }],
  sections: [{ id: S, label: "Terms", startBlockId: B, keepTogether: false, pageBreakBefore: false }],
}

function Canvas({ editable = true, fields = "design", initial = TERMS, narrow = true }: { editable?: boolean; fields?: "design" | "fill"; initial?: TemplateContentV3; narrow?: boolean }) {
  const history = useEditorHistory<TemplateContentV3>(initial)
  const current = useEditorController({ change: history.set, content: history.state, undo: history.undo })
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  useEffect(() => { controller = current })
  return <EditorCanvas allowFiles answers={answers} controller={current} designable={editable} documentTitle="Agreement" fields={fields} narrow={narrow} onAnswerChange={(key, value) => setAnswers((all) => ({ ...all, [key]: value }))} textEditable={editable} zoom={1} />
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

it("sets blocks side by side, resizes the row from its seam, and lets a block stand alone", async () => {
  root = createRoot(document.body.appendChild(document.createElement("div")))
  // Rows stack on a phone, so their seams appear only where there is room.
  await act(async () => root.render(<Canvas narrow={false} />))
  const choice = INSERT_CHOICES.find((choice) => choice.id === "text-field")!
  await act(async () => controller.insert(choice))
  const first = controller.content.blocks.at(-1)!.id
  await act(async () => controller.insert(choice))
  const second = controller.content.blocks.at(-1)!.id
  const press = (name: string) => act(() => (document.querySelector(`[aria-label="${name}"]`) as HTMLButtonElement).click())
  await act(async () => controller.placeBeside(second, first, "right"))
  expect(controller.content.fieldGroups).toMatchObject([{ columns: 2, startBlockId: first, endBlockId: second }])
  const seam = document.querySelector<HTMLElement>('[data-slot="row-seam"]')!
  await act(async () => seam.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" })))
  expect(controller.content.fieldGroups[0]?.widths).toEqual([5, 7])
  await act(async () => controller.select(first))
  press("Keep with next")
  expect(controller.content.blockRules).toContainEqual({ blockId: first, keepWithNext: true, pageBreakBefore: false })
  press("Stand alone")
  expect(controller.content.fieldGroups).toEqual([])
  expect(templateContentV3Schema.safeParse(controller.content).success).toBe(true)
})

it("lets a signature be drawn with a mouse without carrying its block away", async () => {
  const signature = { fieldKey: "signature", helpText: null, id: B, label: "Signature", required: false, type: "signature_field" as const }
  root = createRoot(document.body.appendChild(document.createElement("div")))
  await act(async () => root.render(<Canvas fields="fill" initial={{ ...createEmptyDocumentContent(), blocks: [signature] }} narrow={false} />))
  const pad = document.querySelector("canvas")!
  const block = pad.closest<HTMLElement>("[data-block-id]")!
  const at = (type: string, x: number) => new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 10 })
  await act(async () => {
    pad.dispatchEvent(Object.assign(at("pointerdown", 10), { pointerId: 1, pointerType: "mouse" }))
    for (const x of [30, 60, 90]) window.dispatchEvent(Object.assign(at("pointermove", x), { pointerId: 1, pointerType: "mouse" }))
  })
  expect(block.style.transform).toBe("")
})

it("keeps the active section pieces when the canvas switches from desktop to phone", async () => {
  root = createRoot(document.body.appendChild(document.createElement("div")))
  await act(async () => root.render(<Canvas narrow={false} />))
  await act(async () => controller.setActiveBlockId(B))
  expect(document.querySelector('[data-slot="section-pieces"]')).not.toBeNull()
  await act(async () => root.render(<Canvas narrow />))
  expect(document.querySelector('[data-slot="section-pieces"]')).not.toBeNull()
})

it("offers placing a picture in front of the text only where there are pages to place it on", async () => {
  const picture = { alignment: "center" as const, altText: "Logo", caption: null, dataUrl: "data:image/png;base64,iVBORw0KGgo=", id: B, type: "image" as const, widthPercent: 50 }
  const initial = { ...createEmptyDocumentContent(), blocks: [picture] }

  for (const narrow of [false, true]) {
    root = createRoot(document.body.appendChild(document.createElement("div")))
    await act(async () => root.render(<Canvas initial={initial} narrow={narrow} />))
    await act(async () => controller.select(B))

    // A phone's column has no pages, so a picture there stays in the text.
    expect(Boolean([...document.querySelectorAll("button")].find((button) => button.textContent === "In line"))).toBe(!narrow)
    act(() => root.unmount())
  }
})

it("moves a selected block a step at a time from the keyboard, across a section's title, and says where it went", async () => {
  const note = "70000000-0000-4000-8000-000000000003"
  const initial: TemplateContentV3 = {
    ...TERMS,
    blocks: [{ alignment: "left", id: note, text: "Read carefully.", type: "paragraph" }, ...TERMS.blocks],
  }
  const key = (target: Element, name: string) =>
    act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ctrlKey: true, key: name, shiftKey: true })))

  root = createRoot(document.body.appendChild(document.createElement("div")))
  await act(async () => root.render(<Canvas initial={initial} narrow={false} />))
  await act(async () => controller.select(note))
  const block = document.querySelector(`[data-block-id="${note}"]`)!

  // Down one step: past the Terms title, as the section's first line.
  await key(block, "ArrowDown")
  expect(controller.content.blocks.map((block) => block.id)).toEqual([note, B])
  expect(controller.content.sections[0]?.startBlockId).toBe(note)
  expect(document.querySelector('[data-slot="editor-announcement"]')?.textContent).toBe("“Read carefully.” moved to 1 of 2, in Terms.")
  // Down again: below the line that was there.
  await key(document.querySelector(`[data-block-id="${note}"]`)!, "ArrowDown")
  expect(controller.content.blocks.map((block) => block.id)).toEqual([B, note])
  expect(controller.content.sections[0]?.startBlockId).toBe(B)
  expect((document.querySelector('[aria-label="Move down"]') as HTMLButtonElement).disabled).toBe(true)
})

it("moves a page's margins in pairs, so the text stays centred", async () => {
  root = createRoot(document.body.appendChild(document.createElement("div")))
  await act(async () => root.render(<Canvas narrow={false} />))
  const left = document.querySelector<HTMLElement>('[aria-label="Left margin"]')!
  const top = document.querySelector<HTMLElement>('[aria-label="Top margin"]')!

  await act(async () => left.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight", shiftKey: true })))
  await act(async () => top.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" })))

  const { margins } = controller.content.layout
  expect(margins).toMatchObject({ left: margins!.right, top: margins!.bottom })
  expect(margins!.left).toBeGreaterThan(margins!.top)
})

it("keeps a field its rule hides on the page while it is built, faded until the answers show it", async () => {
  const pets = "70000000-0000-4000-8000-000000000021"
  const kind = "70000000-0000-4000-8000-000000000022"
  const content = templateContentV3Schema.parse({
    ...TERMS,
    blocks: [
      ...TERMS.blocks,
      { checkedByDefault: false, fieldKey: "pets", helpText: null, id: pets, label: "Any pets?", required: false, type: "checkbox_field" },
      { fieldKey: "pet_kind", helpText: null, id: kind, label: "What kind?", multiline: false, placeholder: null, required: false, type: "text_field", visibleWhen: { operator: "equals", sourceBlockId: pets, value: true } },
    ],
  })
  root = createRoot(document.body.appendChild(document.createElement("div")))
  await act(async () => root.render(<Canvas fields="fill" initial={content} />))
  const conditional = () => document.querySelector<HTMLElement>(`[data-block-id="${kind}"]`)

  expect(conditional()?.dataset.hiddenByRule).toBe("")

  await act(async () => document.querySelector<HTMLInputElement>('input[aria-label="Any pets?"]')!.click())

  expect(conditional()?.dataset.hiddenByRule).toBeUndefined()
})

it("opens a block's menu on a right-click, but leaves words being typed in the browser's own menu, and a phone its press and hold", async () => {
  const field = "70000000-0000-4000-8000-000000000031"
  const content = templateContentV3Schema.parse({
    ...TERMS,
    blockRules: [{ blockId: field, frame: { left: 50, width: 50 }, keepWithNext: false, pageBreakBefore: false, spaceAbove: 24 }],
    blocks: [...TERMS.blocks, { fieldKey: "name", helpText: null, id: field, label: "Name", multiline: false, placeholder: null, required: false, type: "text_field" }],
  })
  root = createRoot(document.body.appendChild(document.createElement("div")))
  await act(async () => root.render(<Canvas initial={content} narrow={false} />))
  const rightClick = async (target: Element, pointerType = "mouse") => {
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })
    await act(async () => {
      target.dispatchEvent(Object.assign(new MouseEvent("pointerdown", { bubbles: true, button: 2 }), { pointerType }))
      target.dispatchEvent(menu)
    })
    return menu
  }
  const item = (name: string) => [...document.querySelectorAll<HTMLElement>("[role^=menuitem]")].find((candidate) => candidate.textContent?.trim() === name)
  const words = document.querySelector(`[data-block-id="${B}"] [data-line-key]`)!
  const box = document.querySelector(`[data-block-id="${field}"]`)!

  expect((await rightClick(words)).defaultPrevented).toBe(false)
  expect(document.querySelector("[role=menu]")).toBeNull()

  await rightClick(box, "touch")
  expect(document.querySelector("[role=menu]")).toBeNull()

  // The menu key opens it on a block chosen from the keyboard.
  await act(async () => controller.select(field))
  await act(async () => box.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "F10", shiftKey: true })))
  expect(item("Keep with next")?.getAttribute("aria-checked")).toBe("false")
  await act(async () => item("Reset position")!.click())
  expect(controller.content.blockRules).toEqual([])

  // Typing again in a chosen block's words lets the block go, so Escape can choose it again.
  await act(async () => controller.select(B))
  await act(async () => words.querySelector("[contenteditable]")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true })))
  expect(controller.selectedBlockId).toBeNull()
})

it("makes an answer box taller or shorter from the keyboard, back to its usual height and no shorter than a line", async () => {
  const field = "70000000-0000-4000-8000-000000000041"
  const content = templateContentV3Schema.parse({
    ...TERMS,
    blocks: [...TERMS.blocks, { fieldKey: "name", helpText: null, id: field, label: "Name", multiline: false, placeholder: null, required: false, type: "text_field" }],
  })
  root = createRoot(document.body.appendChild(document.createElement("div")))
  await act(async () => root.render(<Canvas initial={content} narrow={false} />))
  await act(async () => controller.select(field))
  const press = (key: string) => act(async () => void document.querySelector(`[data-block-id="${field}"]`)!.dispatchEvent(new KeyboardEvent("keydown", { altKey: true, bubbles: true, cancelable: true, key, shiftKey: true })))
  const height = () => (controller.content.blocks.find((block) => block.id === field) as { boxHeight?: number }).boxHeight

  await press("ArrowDown")
  expect(height()).toBe(32)
  await press("ArrowUp")
  expect(controller.content.blocks.find((block) => block.id === field)).not.toHaveProperty("boxHeight")
  for (let step = 0; step < 4; step += 1) await press("ArrowUp")
  expect(height()).toBe(27)
  expect(templateContentV3Schema.safeParse(controller.content).success).toBe(true)
})

it("offers a choice as radio buttons that answer under the dropdown's own name, empty until one is chosen", async () => {
  const choice = { fieldKey: "renew", helpText: null, id: B, label: "Renew automatically?", options: ["Yes", "No"], placeholder: null, required: true, type: "dropdown_field" as const, display: "radios" as const }
  const form = document.body.appendChild(document.createElement("form"))
  root = createRoot(form.appendChild(document.createElement("div")))
  await act(async () => root.render(<Canvas fields="fill" initial={templateContentV3Schema.parse({ ...createEmptyDocumentContent(), blocks: [choice] })} />))
  const group = document.querySelector('[role="radiogroup"][aria-label="Renew automatically?"]')
  const radios = [...(group?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [])]

  expect(radios.map((radio) => radio.value)).toEqual(["Yes", "No"])
  expect(parseGeneratedDocumentAnswers(new FormData(form))).toEqual({ renew: "" })

  await act(async () => radios[1]!.click())

  expect(parseGeneratedDocumentAnswers(new FormData(form))).toEqual({ renew: "No" })
})
