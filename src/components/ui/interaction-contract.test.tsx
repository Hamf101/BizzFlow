// @vitest-environment jsdom

import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"

import { Button } from "./button"
import { Switch } from "./switch"

afterEach(() => {
  document.body.replaceChildren()
})

function render(ui: ReactElement): void {
  document.body.innerHTML = renderToStaticMarkup(ui)
}

describe("shared interaction target contract", () => {
  it.each([
    ["default", "Save changes"],
    ["sm", "Filter"],
    ["icon", "Open actions"],
  ] as const)(
    "keeps the %s Button at least 44px at every breakpoint",
    (size, label) => {
      render(
        <Button aria-label={label} size={size}>
          {size === "icon" ? "+" : label}
        </Button>
      )

      const button = document.querySelector('[data-slot="button"]')

      expect(button?.className).toContain(
        size === "icon" ? "size-11" : "h-11"
      )
      expect(button?.className).not.toMatch(/md:(?:h|size)-[6789]/)
    }
  )

  it("gives Switch a physical 44px control cell with visible focus and disabled state", () => {
    render(<Switch aria-label="Email notifications" />)

    const control = document.querySelector('[data-slot="switch"]')

    expect(control?.className).toContain("h-11")
    expect(control?.className).toContain("min-w-11")
    expect(control?.className).toContain("focus-visible:ring-2")
    expect(control?.className).toContain("data-disabled:opacity-50")
  })
})
