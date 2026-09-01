// @vitest-environment jsdom

import type { ComponentProps, ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

const linkStatus = vi.hoisted(() => ({ pending: false }))

vi.mock("next/link", async () => {
  const { createElement } = await import("react")

  return {
    default: ({
      prefetch,
      ...props
    }: ComponentProps<"a"> & { prefetch?: boolean }) => {
      void prefetch
      return createElement("a", props)
    },
    useLinkStatus: () => ({ pending: linkStatus.pending }),
  }
})
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ prefetch: vi.fn() }),
}))

import { DashboardNavigation } from "./dashboard-navigation"

afterEach(() => {
  linkStatus.pending = false
  document.body.replaceChildren()
})

function render(ui: ReactElement): void {
  document.body.innerHTML = renderToStaticMarkup(ui)
}

describe("DashboardNavigation", () => {
  it("renders only authorized links with current-page semantics and 44px rows", () => {
    render(<DashboardNavigation role="external_reviewer" />)

    const navigation = document.querySelector(
      'nav[aria-label="Primary navigation"]'
    )
    const links = [...(navigation?.querySelectorAll("a") ?? [])]

    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/dashboard",
      "/people",
      "/documents",
      "/submissions",
      "/settings",
    ])
    expect(links[0]?.getAttribute("aria-current")).toBe("page")
    expect(links.every((link) => link.className.includes("min-h-11"))).toBe(
      true
    )
  })

  it("pairs visual pending feedback with a route-specific live status", () => {
    linkStatus.pending = true

    render(<DashboardNavigation role="owner_admin" />)

    const documentsLink = document.querySelector('a[href="/documents"]')

    expect(
      documentsLink?.querySelector('[data-navigation-pending="/documents"]')
    ).not.toBeNull()
    expect(
      documentsLink?.querySelector('[role="status"][aria-label="Opening Documents"]')
    ).not.toBeNull()
  })
})
