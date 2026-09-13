// @vitest-environment jsdom

import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"

import { ListFilterChips } from "./list-filter-chips"

afterEach(() => {
  document.body.replaceChildren()
})

function render(ui: ReactElement): void {
  document.body.innerHTML = renderToStaticMarkup(ui)
}

describe("ListFilterChips", () => {
  it("links every option and marks only the current one", () => {
    render(
      <ListFilterChips
        label="Filter tasks by status"
        options={[
          { href: "/tasks", label: "All", selected: true },
          { href: "/tasks?status=open", label: "Open", selected: false },
        ]}
      />
    )

    expect(
      Array.from(
        document.querySelectorAll('nav[aria-label="Filter tasks by status"] a')
      ).map((link) => ({
        current: link.getAttribute("aria-current"),
        href: link.getAttribute("href"),
        text: link.textContent,
      }))
    ).toEqual([
      { current: "true", href: "/tasks", text: "All" },
      { current: null, href: "/tasks?status=open", text: "Open" },
    ])
  })
})
