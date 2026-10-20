// @vitest-environment jsdom
import type { ComponentProps } from "react"

import { act } from "react"
import { beforeAll, expect, it, vi } from "vitest"

import { SheetEditor } from "@/components/sheets/sheet-editor"
import { book } from "@/lib/sheet/sheet.test-support"
import type { Sheet } from "@/services/sheet-service"
import { mount } from "@/test/render"

beforeAll(() => {
  window.matchMedia ??= ((query: string) =>
    ({ addEventListener() {}, matches: false, media: query, removeEventListener() {} }) as unknown as MediaQueryList)
})

const saved = () => vi.fn(async () => ({ ok: true as const, version: "2026-10-14T12:00:01.000Z" }))

function open({
  canEdit = true,
  content = book({ B2: 4, C2: 5 }),
  saveAction = saved(),
}: { canEdit?: boolean; content?: ReturnType<typeof book>; saveAction?: ComponentProps<typeof SheetEditor>["saveAction"] } = {}) {
  const sheet: Sheet = {
    accessLevel: canEdit ? "contributor" : "viewer",
    content,
    folderId: null,
    id: "sheet-1",
    lifecycleState: "active",
    title: "Budget",
    updatedAt: "2026-10-14T12:00:00.000Z",
  }

  act(() =>
    mount().render(
      <SheetEditor backHref="/documents" canEdit={canEdit} canShare={false} guest={false} organizationId={null} saveAction={saveAction} sheet={sheet} />
    )
  )
  return saveAction
}

const grid = () => document.querySelector<HTMLElement>('[role="grid"]')!
const cell = (address: string) => document.querySelector<HTMLElement>(`[role="gridcell"][id$="-${address}"]`)!
const formulaBar = () => document.querySelector<HTMLInputElement>('input[aria-label="Formula bar"]')!

function click(address: string, shiftKey = false): void {
  act(() => cell(address).dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, shiftKey })))
  act(() => grid().dispatchEvent(new MouseEvent("pointerup", { bubbles: true })))
}

function press(target: HTMLElement, key: string, options: KeyboardEventInit = {}): void {
  act(() => target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...options })))
}

function typeInto(input: HTMLInputElement | HTMLSelectElement, value: string, event = "input"): void {
  act(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set?.call(input, value)
    input.dispatchEvent(new Event(event, { bubbles: true }))
  })
}

// Types into the selected cell as a person does: a key starts it, Enter keeps it.
function enter(text: string): void {
  press(grid(), text[0]!)
  const input = document.querySelector<HTMLInputElement>('[data-slot="sheet-cell-input"]')!
  typeInto(input, text)
  press(input, "Enter")
}

it("works a typed formula out on Enter and keeps the formula in the bar", () => {
  open()

  click("D2")
  enter("=B2*C2")

  expect(cell("D2").textContent).toBe("20")
  expect(document.activeElement).toBe(grid())
  click("D2")
  expect(formulaBar().value).toBe("=B2*C2")
})

it("outlines the cells a range formula reads, in the colour the bar gives it", () => {
  open({ content: book({ B2: 1, C3: 2, E1: "=SUM(B2:C3)*A1" }) })

  click("E1")

  const outlines = [...document.querySelectorAll<HTMLElement>('[data-slot="sheet-reference"]')]
  expect(outlines.map((outline) => [outline.style.left, outline.style.top, outline.style.width, outline.style.height])).toEqual([
    ["140px", "52px", "192px", "56px"],
    ["44px", "24px", "96px", "28px"],
  ])
  expect(outlines[0]!.style.borderColor).toBe("var(--primary)")
  const coloured = document.querySelector<HTMLElement>('[data-slot="sheet-formula-bar"] span[style]')!
  expect([coloured.textContent, coloured.style.color]).toEqual(["B2:C3", "var(--primary)"])
})

it("fills a formula down with its references moved row by row", () => {
  open({ content: book({ A1: "=B1*2", B1: 1, B2: 2, B3: 3 }) })

  click("A1")
  click("A3", true)
  press(grid(), "d", { ctrlKey: true })

  expect([cell("A2").textContent, cell("A3").textContent]).toEqual(["4", "6"])
  click("A3")
  expect(formulaBar().value).toBe("=B3*2")
})

it("pastes a block copied from Excel as values, numbers as numbers", () => {
  open({ content: book({}) })

  click("A1")
  const paste = Object.assign(new Event("paste", { bubbles: true, cancelable: true }), {
    clipboardData: { getData: () => 'Item\tQty\r\nPens\t3\r\n"Ink, ""blue"""\t2\r\n' },
  })
  act(() => grid().dispatchEvent(paste))

  expect([cell("A3").textContent, cell("B2").textContent, cell("B3").textContent]).toEqual(['Ink, "blue"', "3", "2"])
  expect(cell("B2").className).toContain("text-right")
  // The pasted block stays selected, and its numbers are summed.
  expect(document.querySelector('[data-slot="sheet-stats"]')?.textContent).toContain("Sum 5")
})

it("shows money once the toolbar makes a cell Money", () => {
  open({ content: book({ A1: 1200 }) })

  click("A1")
  expect(cell("A1").textContent).toBe("1200")
  typeInto(document.querySelector<HTMLSelectElement>('select[aria-label="Number format"]')!, "money", "change")

  expect(cell("A1").textContent).toBe("₦1,200.00")
})

it("adds a tab and renames it on a double-click", () => {
  open()

  act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Add tab"]')!.click())
  const added = document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!
  expect(added.textContent).toBe("Sheet2")

  act(() => added.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })))
  const name = document.querySelector<HTMLInputElement>('input[aria-label="Tab name"]')!
  typeInto(name, "Q3 plan")
  act(() => name.blur())

  expect([...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(["Sheet1", "Q3 plan"])
})

it("gives a viewer a grid to read and copy, and nothing to change", () => {
  open({ canEdit: false })

  expect(document.querySelector('[data-slot="sheet-toolbar"]')).toBeNull()
  expect(grid().getAttribute("aria-readonly")).toBe("true")
  click("B2")
  press(grid(), "9")
  press(grid(), "Delete")

  expect(document.querySelector('[data-slot="sheet-cell-input"]')).toBeNull()
  expect(cell("B2").textContent).toBe("4")
  expect(formulaBar().readOnly).toBe(true)
})

it("stops saving and says so when the sheet changed elsewhere", async () => {
  const saveAction = vi.fn(async () => ({ message: "Changed.", ok: false as const, status: 409 }))
  open({ saveAction })

  click("A1")
  enter("7")

  await vi.waitFor(() => expect(document.querySelector('[data-slot="editor-notice"]')?.textContent).toContain("This sheet changed elsewhere"), {
    timeout: 3000,
  })
  expect(saveAction).toHaveBeenCalledWith(expect.objectContaining({ documentId: "sheet-1", expectedUpdatedAt: "2026-10-14T12:00:00.000Z" }))
})

it("moves a cut block, then copies it on from where it landed", () => {
  open({ content: book({ A1: 5, B1: "=A1*2" }) })
  let clipboard = ""
  const clip = (type: "cut" | "paste") =>
    act(() =>
      grid().dispatchEvent(
        Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
          clipboardData: { getData: () => clipboard, setData: (_: string, text: string) => (clipboard = text) },
        })
      )
    )

  click("A1")
  click("B1", true)
  clip("cut")
  click("C1")
  clip("paste")
  expect(cell("D1").textContent).toBe("10")

  // Pasted again, it is a copy of C1:D1: D1's "C1*2" becomes "E1*2" at F1.
  click("E1")
  clip("paste")
  click("F1")
  expect(formulaBar().value).toBe("=E1*2")
})
