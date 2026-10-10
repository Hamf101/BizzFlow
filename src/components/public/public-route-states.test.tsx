// @vitest-environment jsdom

import { act } from "react"
import type { ReactElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const captureUnexpectedError = vi.hoisted(() => vi.fn())

vi.mock("@/lib/observability", () => ({ captureUnexpectedError }))

import AcceptInviteError from "@/app/(auth)/accept-invite/[token]/error"
import PublicFormError from "@/app/forms/[token]/error"
import PublicSigningError from "@/app/sign/[token]/error"
import { mount } from "@/test/render"

const PRIVATE_MARKER = "private-token-tenant-stack"

beforeEach(() => {
  captureUnexpectedError.mockReset()
})

afterEach(() => {
  window.history.replaceState(null, "", "/")
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

describe("public route error boundaries", () => {
  it.each(PUBLIC_ERROR_STATES)(
    "keeps the $name route fixed, private, and recoverable",
    async ({ boundary, path, render: renderError }) => {
      const error = createPrivateError()
      const reset = vi.fn()
      window.history.replaceState(null, "", path)

      await render(renderError(error, reset))

      const state = document.querySelector('[data-slot="error-state"]')

      expect(state?.getAttribute("role")).toBe("alert")
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
