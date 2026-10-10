// @vitest-environment jsdom

import { act } from "react"
import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const captureUnexpectedError = vi.hoisted(() => vi.fn())

const pathname = vi.hoisted(() => ({ current: "/dashboard" }))

vi.mock("@/lib/observability", () => ({ captureUnexpectedError }))
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }))

import DashboardError from "@/app/(dashboard)/error"

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

const SECTIONS = [
  { name: "Dashboard", path: "/dashboard" },
  { name: "Files", path: "/documents/123" },
  { name: "Templates", path: "/templates" },
  { name: "Submissions", path: "/submissions/new" },
  { name: "Tasks", path: "/tasks" },
  { name: "People", path: "/people" },
  { name: "Audit log", path: "/audit-log" },
  { name: "Settings", path: "/settings" },
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

describe("dashboard route error boundary", () => {
  it.each(SECTIONS)(
    "keeps $name fixed, recoverable, and free of exception detail",
    async ({ name, path }) => {
      pathname.current = path
      await render(<DashboardError error={createPrivateError()} reset={vi.fn()} />)

      expect(document.body.textContent).toContain(`${name} didn’t load.`)
      expect(document.body.textContent).not.toContain(PRIVATE_MARKER)
      expect(document.body.innerHTML).not.toContain(PRIVATE_MARKER)
    }
  )
})
