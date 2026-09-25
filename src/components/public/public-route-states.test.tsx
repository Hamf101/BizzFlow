// @vitest-environment jsdom

import { act } from "react"
import type { ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const captureUnexpectedError = vi.hoisted(() => vi.fn())

vi.mock("@/lib/observability", () => ({ captureUnexpectedError }))

import AcceptInviteError from "@/app/(auth)/accept-invite/[token]/error"
import PublicFormError from "@/app/forms/[token]/error"
import PublicFormLoading from "@/app/forms/[token]/loading"
import PublicSigningError from "@/app/sign/[token]/error"
import PublicSigningLoading from "@/app/sign/[token]/loading"

const mountedRoots: Root[] = []
const PRIVATE_MARKER = "private-token-tenant-stack"

beforeAll(() => {
  ;(
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean
    }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  captureUnexpectedError.mockReset()
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.replaceChildren()
  window.history.replaceState(null, "", "/")
})

async function render(ui: ReactElement): Promise<void> {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mountedRoots.push(root)

  await act(async () => root.render(ui))
}

function createPrivateError(): Error & { digest?: string } {
  const error = new Error(PRIVATE_MARKER) as Error & { digest?: string }
  error.digest = `${PRIVATE_MARKER}-digest`
  error.stack = `${PRIVATE_MARKER}-stack`
  return error
}

const PUBLIC_LOADING_STATES: ReadonlyArray<{
  label: string
  name: string
  render: () => ReactElement
}> = [
  {
    label: "Loading form",
    name: "public form",
    render: () => <PublicFormLoading />,
  },
  {
    label: "Loading signing page",
    name: "signing",
    render: () => <PublicSigningLoading />,
  },
]

const PUBLIC_ERROR_STATES: ReadonlyArray<{
  boundary: string
  name: string
  path: string
  render: (
    error: Error & { digest?: string },
    reset: () => void
  ) => ReactElement
}> = [
  {
    boundary: "accept-invite",
    name: "invitation",
    path: `/accept-invite/${PRIVATE_MARKER}`,
    render: (error, reset) => (
      <AcceptInviteError error={error} reset={reset} />
    ),
  },
  {
    boundary: "public-form",
    name: "public form",
    path: `/forms/${PRIVATE_MARKER}`,
    render: (error, reset) => <PublicFormError error={error} reset={reset} />,
  },
  {
    boundary: "sign",
    name: "signing",
    path: `/sign/${PRIVATE_MARKER}`,
    render: (error, reset) => <PublicSigningError error={error} reset={reset} />,
  },
]

describe("public route loading boundaries", () => {
  it.each(PUBLIC_LOADING_STATES)(
    "announces the $name state while hiding reduced-motion-safe geometry",
    async ({ label, render: renderLoading }) => {
      await render(renderLoading())

      const status = document.querySelector('[role="status"]')
      const geometry = document.querySelector(
        '[data-slot="public-page-skeleton-content"]'
      )

      expect(status?.getAttribute("aria-live")).toBe("polite")
      expect(status?.textContent).toContain(label)
      expect(geometry?.getAttribute("aria-hidden")).toBe("true")
      expect(geometry?.className).toContain("motion-reduce:animate-none")
      expect(document.body.innerHTML).not.toContain(PRIVATE_MARKER)
    }
  )
})

describe("public route error boundaries", () => {
  it.each(PUBLIC_ERROR_STATES)(
    "keeps the $name route fixed, unframed, and recoverable",
    async ({ boundary, path, render: renderError }) => {
      const error = createPrivateError()
      const reset = vi.fn()
      window.history.replaceState(null, "", path)

      await render(renderError(error, reset))

      const state = document.querySelector('[data-slot="error-state"]')

      expect(state?.getAttribute("role")).toBe("alert")
      expect(state?.querySelector("h2")?.textContent).toBe(
        "This page didn’t load."
      )
      expect(state?.textContent).toContain(
        "Try again. If the problem continues, ask your contact for a new link."
      )
      expect(state?.className).not.toMatch(/\bborder(?:-|\b)/)
      expect(document.body.textContent).not.toContain(PRIVATE_MARKER)
      expect(document.body.innerHTML).not.toContain(PRIVATE_MARKER)
      expect(captureUnexpectedError).toHaveBeenCalledExactlyOnceWith(error, {
        boundary,
      })

      act(() => {
        document.querySelector<HTMLButtonElement>("button")?.click()
      })

      expect(reset).toHaveBeenCalledOnce()
      expect(window.location.pathname).toBe(path)
    }
  )
})
