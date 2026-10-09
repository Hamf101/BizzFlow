// @vitest-environment jsdom

import { act } from "react"
import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const captureUnexpectedError = vi.hoisted(() => vi.fn())

vi.mock("@/lib/observability", () => ({ captureUnexpectedError }))

import AuditLogError from "@/app/(dashboard)/audit-log/error"
import DashboardError from "@/app/(dashboard)/dashboard/error"
import DocumentsError from "@/app/(dashboard)/documents/error"
import PeopleError from "@/app/(dashboard)/people/error"
import SettingsError from "@/app/(dashboard)/settings/error"
import SubmissionsError from "@/app/(dashboard)/submissions/error"
import TasksError from "@/app/(dashboard)/tasks/error"
import TemplatesError from "@/app/(dashboard)/templates/error"

import { DashboardRouteError } from "./dashboard-route-error"
import { mount } from "@/test/render"

const PRIVATE_MARKER = "private-token-tenant-stack"

beforeEach(() => {
  captureUnexpectedError.mockReset()
})

async function render(ui: ReactElement): Promise<void> {
  const root = mount()

  await act(async () => root.render(ui))
}

function createPrivateError(): Error & { digest?: string } {
  const error = new Error(PRIVATE_MARKER) as Error & { digest?: string }
  error.digest = `${PRIVATE_MARKER}-digest`
  error.stack = `${PRIVATE_MARKER}-stack`
  return error
}

const ROUTE_ERRORS: ReadonlyArray<{
  name: string
  render: (error: Error & { digest?: string }, reset: () => void) => ReactElement
}> = [
  { name: "Dashboard", render: (error, reset) => <DashboardError error={error} reset={reset} /> },
  { name: "Files", render: (error, reset) => <DocumentsError error={error} reset={reset} /> },
  { name: "Templates", render: (error, reset) => <TemplatesError error={error} reset={reset} /> },
  { name: "Submissions", render: (error, reset) => <SubmissionsError error={error} reset={reset} /> },
  { name: "Tasks", render: (error, reset) => <TasksError error={error} reset={reset} /> },
  { name: "People", render: (error, reset) => <PeopleError error={error} reset={reset} /> },
  { name: "Audit log", render: (error, reset) => <AuditLogError error={error} reset={reset} /> },
  { name: "Settings", render: (error, reset) => <SettingsError error={error} reset={reset} /> },
]

describe("DashboardRouteError", () => {
  it("reports the original error but renders only fixed safe copy", async () => {
    const error = createPrivateError()

    await render(
      <DashboardRouteError
        boundary="documents"
        error={error}
        reset={vi.fn()}
        routeName="Documents"
      />
    )

    expect(document.body.textContent).toContain("Documents didn’t load.")
    expect(document.body.textContent).toContain(
      "Try again, or return to the dashboard."
    )
    expect(document.body.textContent).not.toContain(PRIVATE_MARKER)
    expect(document.body.innerHTML).not.toContain(PRIVATE_MARKER)
    expect(captureUnexpectedError).toHaveBeenCalledExactlyOnceWith(error, {
      boundary: "documents",
    })
  })

  it("retries once and keeps the safe dashboard route available", async () => {
    const reset = vi.fn()

    await render(
      <DashboardRouteError
        boundary="tasks"
        error={createPrivateError()}
        reset={reset}
        routeName="Tasks"
      />
    )

    document.querySelector<HTMLButtonElement>("button")?.click()

    expect(reset).toHaveBeenCalledOnce()
    expect(document.querySelector('a[href="/dashboard"]')?.textContent).toBe(
      "Return to dashboard"
    )
  })
})

describe("dashboard route error boundaries", () => {
  it.each(ROUTE_ERRORS)(
    "keeps $name fixed, recoverable, and free of exception detail",
    async ({ name, render }) => {
      await renderRouteError(render)

      expect(document.body.textContent).toContain(`${name} didn’t load.`)
      expect(document.body.textContent).not.toContain(PRIVATE_MARKER)
      expect(document.body.innerHTML).not.toContain(PRIVATE_MARKER)
    }
  )
})

async function renderRouteError(
  routeError: (
    error: Error & { digest?: string },
    reset: () => void
  ) => ReactElement
): Promise<void> {
  await render(routeError(createPrivateError(), vi.fn()))
}
