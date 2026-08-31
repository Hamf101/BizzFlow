// @vitest-environment jsdom

import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"

import { PageHeader } from "./page-header"

afterEach(() => {
  document.body.replaceChildren()
})

function render(ui: ReactElement): void {
  document.body.innerHTML = renderToStaticMarkup(ui)
}

describe("PageHeader", () => {
  it("renders one route heading with optional copy and a responsive action slot", () => {
    render(
      <PageHeader
        action={<button type="button">Upload document</button>}
        description="Create, organize, and review organization documents."
        title="Documents"
      />
    )

    const header = document.querySelector('[data-slot="page-header"]')
    const actions = document.querySelector('[data-slot="page-header-action"]')

    expect(document.querySelectorAll("h1")).toHaveLength(1)
    expect(document.querySelector("h1")?.textContent).toBe("Documents")
    expect(document.querySelector('[data-slot="page-header-description"]')?.textContent).toBe(
      "Create, organize, and review organization documents."
    )
    expect(actions?.textContent).toBe("Upload document")
    expect(header?.className).toContain("flex-col")
    expect(header?.className).toContain("sm:flex-row")
  })

  it("does not invent descriptive copy or actions when the caller omits them", () => {
    render(<PageHeader title="Audit log" />)

    expect(document.querySelector("h1")?.textContent).toBe("Audit log")
    expect(
      document.querySelector('[data-slot="page-header-description"]')
    ).toBeNull()
    expect(
      document.querySelector('[data-slot="page-header-action"]')
    ).toBeNull()
  })
})
