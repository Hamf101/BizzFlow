// @vitest-environment jsdom

import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import AuditLogLoading from "@/app/(dashboard)/audit-log/loading"
import DashboardLoading from "@/app/(dashboard)/dashboard/loading"
import DocumentsLoading from "@/app/(dashboard)/documents/loading"
import PeopleLoading from "@/app/(dashboard)/people/loading"
import SettingsLoading from "@/app/(dashboard)/settings/loading"
import SubmissionsLoading from "@/app/(dashboard)/submissions/loading"
import TasksLoading from "@/app/(dashboard)/tasks/loading"
import TemplatesLoading from "@/app/(dashboard)/templates/loading"

import { DashboardContentSkeleton } from "./dashboard-content-skeleton"

const ROUTE_STATES: ReadonlyArray<{
  context: string
  label: string
  render: () => ReactElement
  variant: "list" | "overview" | "split"
}> = [
  {
    context: "Dashboard",
    label: "Loading dashboard",
    render: () => <DashboardLoading />,
    variant: "overview",
  },
  {
    context: "Documents",
    label: "Loading documents",
    render: () => <DocumentsLoading />,
    variant: "list",
  },
  {
    context: "Templates",
    label: "Loading templates",
    render: () => <TemplatesLoading />,
    variant: "list",
  },
  {
    context: "Submissions",
    label: "Loading submissions",
    render: () => <SubmissionsLoading />,
    variant: "list",
  },
  {
    context: "Tasks",
    label: "Loading tasks",
    render: () => <TasksLoading />,
    variant: "list",
  },
  {
    context: "People",
    label: "Loading people",
    render: () => <PeopleLoading />,
    variant: "list",
  },
  {
    context: "Audit log",
    label: "Loading audit log",
    render: () => <AuditLogLoading />,
    variant: "list",
  },
  {
    context: "Settings",
    label: "Loading settings",
    render: () => <SettingsLoading />,
    variant: "split",
  },
]

describe("authenticated route loading states", () => {
  it.each(ROUTE_STATES)(
    "renders a safe, named $context state inside the existing shell",
    ({ context, label, render, variant }) => {
      const markup = renderToStaticMarkup(render())
      document.body.innerHTML = markup

      const status = document.querySelector('[role="status"]')
      const geometry = document.querySelector(
        '[data-slot="page-skeleton-content"]'
      )
      const marker = document.querySelector(
        '[data-slot="page-skeleton-context"]'
      )

      expect(status?.getAttribute("aria-live")).toBe("polite")
      expect(status?.getAttribute("data-variant")).toBe(variant)
      expect(status?.textContent).toContain(label)
      expect(marker?.textContent).toBe(context)
      expect(geometry?.getAttribute("aria-hidden")).toBe("true")
      expect(markup).not.toMatch(
        /Northstar|Manager|token|Invite member|Add document|Create template/i
      )
    }
  )

  it("keeps the third list placeholder out of the initial mobile layout", () => {
    document.body.innerHTML = renderToStaticMarkup(<DocumentsLoading />)

    const rows = document.querySelectorAll('[data-slot="page-skeleton-row"]')

    expect(rows).toHaveLength(3)
    expect(rows[2]?.className).toContain("hidden")
    expect(rows[2]?.className).toContain("sm:grid")
  })

  it("keeps the parent shell fallback generic and non-sensitive", () => {
    const markup = renderToStaticMarkup(<DashboardContentSkeleton />)

    document.body.innerHTML = markup

    expect(
      document.querySelector('[data-slot="page-skeleton-context"]')
        ?.textContent
    ).toBe("Workspace")
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "Loading page"
    )
    expect(markup).not.toMatch(/Northstar|Manager|token|Invite|Create/i)
  })
})
