// @vitest-environment jsdom

import type { Editor } from "@tiptap/core"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, expect, it, vi } from "vitest"

import type { TextCaret } from "@/components/editor/editable-text"
import { RichLine } from "@/components/editor/rich-line"
import type { TextRun } from "@/types/template"

const roots: Root[] = []

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // The caret is scrolled into view by measuring text, which jsdom does not lay out.
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
})

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.replaceChildren()
})

type Props = Parameters<typeof RichLine>[0]

async function render(props: Partial<Props> & Pick<Props, "value">): Promise<(next: Partial<Props>) => Promise<void>> {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  let current: Props = { as: "div", caretKey: "line", label: "Text", onChange: () => undefined, ...props }
  roots.push(root)
  await act(async () => root.render(<RichLine {...current} />))

  return async (next) => {
    current = { ...current, ...next }
    await act(async () => root.render(<RichLine {...current} />))
  }
}

// Tiptap keeps its editor on the line it draws.
const line = (): HTMLElement & { editor: Editor } =>
  document.querySelector<HTMLElement & { editor: Editor }>('[data-caret-key="line"]')!

it("formats the chosen words, and hands the line back as a saved document keeps it", async () => {
  const onChange = vi.fn()
  await render({ onChange, value: "Pay within 30 days" })

  await act(async () => line().editor.chain().setTextSelection({ from: 4, to: 18 }).toggleBold().run())
  await act(async () => line().editor.chain().setTextSelection({ from: 11, to: 18 }).setMark("textStyle", { color: "#a24949" }).run())

  expect(onChange).toHaveBeenLastCalledWith(
    "Pay within 30 days",
    [{ text: "Pay " }, { bold: true, text: "within " }, { bold: true, color: "#a24949", text: "30 days" }],
    18
  )
  expect([...line().querySelectorAll("strong")].map((bold) => bold.textContent)).toEqual(["within ", "30 days"])
  expect(line().querySelector<HTMLElement>("span[style]")?.style.color).toBe("rgb(162, 73, 73)")
})

it("hands every key to the canvas first, and a key the canvas takes goes no further", async () => {
  const caret = vi.fn<(caret: TextCaret) => void>()
  const onChange = vi.fn()
  await render({
    onChange,
    onKeyDown: (event, at) => {
      caret(at)
      event.preventDefault()
    },
    runs: [{ italic: true, text: "Terms" }],
    value: "Terms",
  })
  const press = (init: KeyboardEventInit): boolean =>
    line().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }))

  await act(async () => line().editor.commands.setTextSelection(5))
  press({ key: "Enter" })

  expect(caret).toHaveBeenCalledWith({
    atEnd: true,
    atStart: false,
    collapsed: true,
    offset: 5,
    runs: [{ italic: true, text: "Terms" }],
    text: "Terms",
  })

  // Bold's own shortcut, which the canvas took first.
  await act(async () => line().editor.commands.setTextSelection({ from: 0, to: 5 }))
  press({ ctrlKey: true, key: "b" })

  expect(onChange).not.toHaveBeenCalled()
})

it("rewrites itself when its words change elsewhere, as after an undo, and puts the caret where it is asked", async () => {
  const rerender = await render({ value: "Deposit" })
  const runs: TextRun[] = [{ text: "Deposit " }, { link: "https://pay.example.com", text: "online" }]

  await rerender({ runs, value: "Deposit online" })

  expect(line().textContent).toBe("Deposit online")
  expect(line().querySelector("a")?.getAttribute("href")).toBe("https://pay.example.com")

  await rerender({ focus: { nonce: 1, offset: 3 } })

  expect(line().editor.state.selection.head).toBe(3)
})

it("keeps a chosen font through editing and a reload, and loads its stylesheet", async () => {
  const onChange = vi.fn()
  const rerender = await render({ onChange, value: "Invoice" })

  await act(async () => line().editor.chain().setTextSelection({ from: 0, to: 7 }).setMark("textStyle", { font: "roboto" }).run())
  expect(onChange).toHaveBeenLastCalledWith("Invoice", [{ font: "roboto", text: "Invoice" }], 7)

  await rerender({ runs: [{ font: "roboto", text: "Invoice" }] })
  expect(line().querySelector("[data-font]")?.getAttribute("data-font")).toBe("roboto")
  expect(document.querySelector('link[href="/fonts/roboto/font.css"]')).not.toBeNull()
})

it("takes in words someone else typed in the same line, keeping this person's caret in its place", async () => {
  const rerender = await render({ value: "Hello world" })
  await act(async () => {
    line().editor.commands.focus()
    line().editor.commands.setTextSelection(5)
  })

  // Another editor adds words before the caret, then after it.
  await rerender({ value: "Oh, Hello world" })
  expect(line().editor.state.selection.head).toBe(9)
  await rerender({ value: "Oh, Hello big world" })
  expect(line().editor.state.selection.head).toBe(9)
  expect(line().editor.getText()).toBe("Oh, Hello big world")
})
