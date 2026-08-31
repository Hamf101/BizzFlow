// @vitest-environment jsdom

import type { ReactElement } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "./sheet"

const mountedRoots: Root[] = []

beforeAll(() => {
  ;(
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean
    }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.replaceChildren()
})

function render(ui: ReactElement): void {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  act(() => root.render(ui))
}

function getButton(name: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name
  )

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected a button named "${name}".`)
  }

  return button
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

describe("Sheet", () => {
  it("provides a labelled 44px close path with reduced-motion-safe transitions", async () => {
    render(
      <Sheet>
        <SheetTrigger>More</SheetTrigger>
        <SheetContent>
          <SheetTitle>Everything else</SheetTitle>
          <SheetClose>Close menu</SheetClose>
        </SheetContent>
      </Sheet>
    )

    const trigger = getButton("More")
    await click(trigger)

    const dialog = document.querySelector('[role="dialog"]')
    const close = getButton("Close menu")
    const title = document.getElementById(
      dialog?.getAttribute("aria-labelledby") ?? ""
    )

    expect(title?.textContent).toBe("Everything else")
    expect(close.className).toContain("min-h-11")
    expect(close.className).toContain("min-w-11")
    expect(dialog?.className).toContain("motion-reduce:transform-none")
    expect(dialog?.className).toContain("motion-reduce:transition-none")

    await click(close)

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
