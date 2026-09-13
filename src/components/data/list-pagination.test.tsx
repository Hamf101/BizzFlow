// @vitest-environment jsdom

import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"

import { ListPagination } from "./list-pagination"

afterEach(() => {
  document.body.replaceChildren()
})

function render(ui: ReactElement): void {
  document.body.innerHTML = renderToStaticMarkup(ui)
}

function readLinks(): Array<{
  href: string | null
  label: string | null
  rel: string | null
}> {
  return Array.from(document.querySelectorAll("a")).map((link) => ({
    href: link.getAttribute("href"),
    label: link.getAttribute("aria-label"),
    rel: link.getAttribute("rel"),
  }))
}

describe("ListPagination", () => {
  it("states the visible range and links to the neighbouring pages", () => {
    render(
      <ListPagination
        nextHref="/tasks?page=3"
        page={2}
        pageSize={50}
        previousHref="/tasks"
        total={132}
      />
    )

    expect(
      document.querySelector('nav[aria-label="Pagination"]')?.textContent
    ).toBe("51–100 of 132")
    expect(readLinks()).toEqual([
      { href: "/tasks", label: "Previous page", rel: "prev" },
      { href: "/tasks?page=3", label: "Next page", rel: "next" },
    ])
  })

  it("omits a link with nowhere to go and ends the range at the total", () => {
    render(
      <ListPagination
        nextHref={null}
        page={3}
        pageSize={50}
        previousHref="/tasks?page=2"
        total={132}
      />
    )

    expect(document.querySelector("nav")?.textContent).toBe("101–132 of 132")
    expect(readLinks()).toEqual([
      { href: "/tasks?page=2", label: "Previous page", rel: "prev" },
    ])
  })

  it("renders nothing when every item fits on one page", () => {
    render(
      <ListPagination
        nextHref={null}
        page={1}
        pageSize={50}
        previousHref={null}
        total={12}
      />
    )

    expect(document.body.innerHTML).toBe("")
  })
})
