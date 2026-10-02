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

import type { DashboardAccount } from "./dashboard-account-menu"
import { DashboardNavigation } from "./dashboard-navigation"
import { DashboardSidebar } from "./dashboard-sidebar"

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
    expect(links.every((link) => link.classList.contains("h-11"))).toBe(true)
  })

  it("keeps navigation visually still while a destination is pending", () => {
    linkStatus.pending = true

    render(<DashboardNavigation role="owner_admin" />)

    const documentsLink = document.querySelector('a[href="/documents"]')

    expect(
      documentsLink?.querySelector('[data-navigation-pending="/documents"]')
    ).toBeNull()
    expect(
      documentsLink?.querySelector('[role="status"][aria-label="Opening Files"]')
    ).toBeNull()
    expect(documentsLink?.textContent).toBe("Files")
  })
})

describe("DashboardSidebar", () => {
  it("names the workspace above its tabs and the member's role on their card", () => {
    const sidebar = (organizationName: string | null, role: Partial<DashboardAccount> = {}): { card?: string; label?: string } => {
      render(<DashboardSidebar account={{ displayName: "Faisal", email: "faisal@example.com", organizationName, permissionSubject: null, role: null, ...role }} signOutAction={async () => undefined} />)
      return {
        card: document.querySelector('[aria-label="Open account menu for Faisal"]')?.textContent ?? undefined,
        label: document.querySelector(".editorial-kicker")?.textContent ?? undefined,
      }
    }

    expect(sidebar("Hawn", { role: "owner_admin", roleName: "Owner" })).toEqual({ card: "FFaisalOwner", label: "Hawn's workspace" })
    expect(sidebar("Acme Tools", { role: "staff" })).toEqual({ card: "FFaisalStaff", label: "Acme Tools' workspace" })
    expect(sidebar(null)).toEqual({ card: "FFaisalfaisal@example.com", label: "Workspace" })
  })
})
