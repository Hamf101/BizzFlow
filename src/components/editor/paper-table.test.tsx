// @vitest-environment jsdom

import { act, type ReactElement, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it } from "vitest"

import type { TableFieldBlock } from "@/types/template"

import { PaperTable } from "./paper-answer-kinds"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.replaceChildren()
})

const items: TableFieldBlock = {
  columns: [{ label: "Item" }, { format: "number", label: "Qty" }, { format: "money", formula: "{Qty} * 2", label: "Amount", total: true }],
  fieldKey: "items",
  helpText: null,
  id: "74000000-0000-4000-8000-000000000001",
  label: "Items",
  required: false,
  rows: 2,
  type: "table_field",
}
let seen: unknown

function Harness(): ReactElement {
  const [value, setValue] = useState<unknown>([["Desk", "1", "2.00"], ["Chair", "", "0.50"]])

  return (
    <PaperTable
      block={items}
      mode="fill"
      onChange={(next) => {
        seen = next
        setValue(next)
      }}
      value={value}
    />
  )
}

it("types into the row a phone's list shows, shows a worked-out column as words, and totals it", async () => {
  const host = document.createElement("div")

  document.body.append(host)
  await act(async () => createRoot(host).render(<Harness />))

  // The phone's list names its rows on from the table's two.
  const phoneQty = host.querySelector<HTMLInputElement>('input[aria-label="Qty, row 3"]')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!

  await act(async () => {
    setValue.call(phoneQty, "4")
    phoneQty.dispatchEvent(new Event("input", { bubbles: true }))
  })

  expect(seen).toEqual([["Desk", "4", "2.00"], ["Chair", "", "0.50"]])
  expect(host.querySelector('input[aria-label^="Amount"]')).toBeNull()
  expect(host.querySelector('output[aria-label="Amount, row 2"]')?.textContent).toBe("0.50")
  expect(host.querySelector("tfoot")?.textContent).toBe("Total2.50")
})
