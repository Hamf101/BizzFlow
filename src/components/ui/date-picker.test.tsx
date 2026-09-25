// @vitest-environment jsdom

import { act, type ReactElement, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it } from "vitest"

import { DatePicker, DateTimePicker } from "./date-picker"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.replaceChildren()
})

function Harness(): ReactElement {
  const [value, setValue] = useState("2026-01-31")

  return (
    <form>
      <DatePicker
        format={{ month: "number", order: "dmy", separator: "/" }}
        id="moved-in"
        name="movedIn"
        onChange={setValue}
        value={value}
      />
    </form>
  )
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

it("steps to the end of a shorter month, lays weeks out from Monday, and posts the day as stored", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  await act(async () => createRoot(host).render(<Harness />))

  const face = document.getElementById("moved-in") as HTMLButtonElement
  expect(face.textContent).toBe("31/01/2026")

  // The calendar's code arrives on the first press.
  await act(async () => {
    face.click()
    await import("./date-picker-calendar")
  })
  await settle()
  const opened = document.activeElement as HTMLElement
  expect(opened.dataset.day).toBe("2026-01-31")

  await act(async () => {
    opened.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "PageDown" }))
  })
  await settle()
  const stepped = document.activeElement as HTMLButtonElement
  expect(stepped.dataset.day).toBe("2026-02-28")

  // 1 February 2026 is a Sunday: the last column when weeks start on Monday.
  const sunday = document.querySelector('[data-day="2026-02-01"]')?.closest("td")
  expect([...(sunday?.parentElement?.children ?? [])].indexOf(sunday as Element)).toBe(6)

  await act(async () => stepped.click())
  expect(document.getElementById("moved-in")?.textContent).toBe("28/02/2026")
  expect(new FormData(document.querySelector("form") as HTMLFormElement).get("movedIn")).toBe("2026-02-28")
})

it("holds a form whose required day and time are still empty, before the calendar is ever opened", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  await act(async () =>
    createRoot(host).render(
      <form>
        <DateTimePicker id="remind-at" name="remindAt" required />
      </form>
    )
  )

  expect(document.querySelector("form")!.checkValidity()).toBe(false)
})
