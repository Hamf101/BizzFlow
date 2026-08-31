// @vitest-environment jsdom

import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"

import { EmptyState, ErrorState, PageSkeleton } from "./page-state"

afterEach(() => {
  document.body.replaceChildren()
})

function render(ui: ReactElement): void {
  document.body.innerHTML = renderToStaticMarkup(ui)
}

describe("PageSkeleton", () => {
  it("announces a safe loading label while hiding placeholder geometry", () => {
    render(<PageSkeleton label="Loading documents" />)

    const status = document.querySelector('[role="status"]')
    const geometry = document.querySelector(
      '[data-slot="page-skeleton-content"]'
    )

    expect(status?.getAttribute("aria-live")).toBe("polite")
    expect(status?.textContent).toContain("Loading documents")
    expect(geometry?.getAttribute("aria-hidden")).toBe("true")
    expect(geometry?.className).toContain("motion-reduce:animate-none")
  })
})

describe("EmptyState", () => {
  it("renders specific caller copy and only the supplied next action", () => {
    render(
      <EmptyState
        action={<button type="button">Upload document</button>}
        description="Upload a document or create one from a published template."
        title="No documents yet"
      />
    )

    const state = document.querySelector('[data-slot="empty-state"]')

    expect(state?.querySelector("h2")?.textContent).toBe("No documents yet")
    expect(state?.textContent).toContain(
      "Upload a document or create one from a published template."
    )
    expect(
      state?.querySelector('[data-slot="page-state-action"]')?.textContent
    ).toBe("Upload document")
  })

  it("does not render an action region without a permission-supplied action", () => {
    render(<EmptyState title="No audit events yet" />)

    expect(
      document.querySelector('[data-slot="page-state-action"]')
    ).toBeNull()
  })
})

describe("ErrorState", () => {
  it("announces a recoverable error with caller-owned recovery UI", () => {
    render(
      <ErrorState
        action={<button type="button">Try again</button>}
        description="Documents could not be loaded. Try again."
        title="Documents unavailable"
      />
    )

    const state = document.querySelector('[data-slot="error-state"]')

    expect(state?.getAttribute("role")).toBe("alert")
    expect(state?.querySelector("h2")?.textContent).toBe(
      "Documents unavailable"
    )
    expect(state?.textContent).toContain(
      "Documents could not be loaded. Try again."
    )
    expect(state?.querySelector("button")?.textContent).toBe("Try again")
    expect(state?.className).not.toMatch(/border-(l|t)-/)
  })
})
