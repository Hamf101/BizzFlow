// @vitest-environment jsdom
import { act } from "react"
import { beforeAll, expect, it, vi } from "vitest"

import { createBlankTemplateContent, type TemplateLayout } from "@/types/template"
import { mount } from "@/test/render"

import { MarginGuides } from "./margin-guides"

beforeAll(() => {
  HTMLElement.prototype.setPointerCapture = () => undefined
})

it("drags a margin with its pair, one alone with the right button or Alt, and opens no menu there", async () => {
  const layout = createBlankTemplateContent().layout
  const onChange = vi.fn<(layout: TemplateLayout) => void>()
  const root = mount()

  await act(async () => root.render(<MarginGuides first layout={layout} onChange={onChange} point={1} zoom={1} />))
  const left = document.querySelector<HTMLElement>('[aria-label="Left margin"]')!
  const drag = (init: MouseEventInit) =>
    act(async () => {
      left.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100, ...init }))
      left.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 110 }))
      left.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }))
    })

  await drag({ button: 0 })
  expect(onChange.mock.lastCall?.[0].margins).toEqual({ top: 72, right: 82, bottom: 72, left: 82 })

  await drag({ button: 2 })
  expect(onChange.mock.lastCall?.[0].margins).toEqual({ top: 72, right: 72, bottom: 72, left: 82 })

  await drag({ altKey: true, button: 0 })
  expect(onChange.mock.lastCall?.[0].margins).toEqual({ top: 72, right: 72, bottom: 72, left: 82 })

  await act(async () => void left.dispatchEvent(new KeyboardEvent("keydown", { altKey: true, bubbles: true, key: "ArrowRight" })))
  expect(onChange.mock.lastCall?.[0].margins).toEqual({ top: 72, right: 72, bottom: 72, left: 73 })

  // Top and bottom move the same way, up and down.
  const top = document.querySelector<HTMLElement>('[aria-label="Top margin"]')!
  const pull = (init: MouseEventInit) =>
    act(async () => {
      top.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientY: 100, ...init }))
      top.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientY: 120 }))
      top.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }))
    })

  await pull({ button: 0 })
  expect(onChange.mock.lastCall?.[0].margins).toEqual({ top: 92, right: 72, bottom: 92, left: 72 })
  await pull({ button: 2 })
  expect(onChange.mock.lastCall?.[0].margins).toEqual({ top: 92, right: 72, bottom: 72, left: 72 })

  const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })

  left.dispatchEvent(menu)
  expect(menu.defaultPrevented).toBe(true)
})
