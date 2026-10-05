// @vitest-environment jsdom
import { act, type ReactElement, useEffect } from "react"
import { createPortal } from "react-dom"
import { createRoot } from "react-dom/client"
import { expect, it } from "vitest"

import { SelectableItem, SelectionProvider, useSelection } from "./selection"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia ??= ((query: string) => ({ addEventListener: () => undefined, matches: false, media: query, removeEventListener: () => undefined })) as never

const ITEMS = [{ id: "a" }, { id: "b" }, { id: "c" }]
let selected: string[] = []

function Seen(): null {
  const now = useSelection()?.selected

  useEffect(() => {
    selected = [...(now ?? [])]
  })
  return null
}

function Files(): ReactElement {
  return (
    <SelectionProvider items={ITEMS} scope="test" shown={ITEMS.map((item) => item.id)}>
      {ITEMS.map((item) => (
        <SelectableItem checkSlot="check" itemId={item.id} key={item.id} slot="row">
          <a href={`#${item.id}`}>{item.id}</a>
          {/* A dialog the row opened, drawn elsewhere on the page. */}
          {item.id === "a" ? createPortal(<input aria-label="Name" />, document.body) : null}
        </SelectableItem>
      ))}
      <Seen />
    </SelectionProvider>
  )
}

function press(target: Element, key: string, options: KeyboardEventInit = {}): void {
  act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...options })))
}

it("selects a row from the keyboard, and leaves what is typed in a dialog it opened alone", () => {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  act(() => root.render(<Files />))
  const link = (id: string) => document.querySelector(`a[href="#${id}"]`)!

  press(link("a"), " ")
  press(link("c"), " ", { shiftKey: true })
  expect(selected.sort()).toEqual(["a", "b", "c"])

  // ⌘A and Escape in the dialog's field are the field's own.
  const field = document.querySelector('input[aria-label="Name"]')!
  press(field, "Escape")
  press(field, "a", { metaKey: true })
  expect(selected.sort()).toEqual(["a", "b", "c"])

  act(() => root.unmount())
})
