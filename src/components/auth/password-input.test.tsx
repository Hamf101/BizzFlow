// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { PasswordInput } from "./password-input"

const mountedRoots: Root[] = []

beforeAll(() => {
  ;(
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean
    }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.replaceChildren()
})

async function renderPasswordInput(): Promise<void> {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mountedRoots.push(root)

  await act(async () =>
    root.render(
      <form>
        <PasswordInput
          autoComplete="current-password"
          className="auth-password"
          id="password"
          minLength={8}
          name="password"
          required
        />
      </form>
    )
  )
}

describe("PasswordInput", () => {
  it("starts masked and preserves the password field contract", async () => {
    await renderPasswordInput()

    const input = document.querySelector<HTMLInputElement>("#password")
    const toggle = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Show password"]'
    )

    expect(input?.type).toBe("password")
    expect(input?.name).toBe("password")
    expect(input?.autocomplete).toBe("current-password")
    expect(input?.required).toBe(true)
    expect(input?.minLength).toBe(8)
    expect(input?.className).toContain("auth-password")
    expect(toggle?.type).toBe("button")
    expect(toggle?.title).toBe("Show password")
    expect(toggle?.getAttribute("aria-pressed")).toBe("false")
  })

  it("reveals and masks the password without interrupting continued typing", async () => {
    await renderPasswordInput()

    const input = document.querySelector<HTMLInputElement>("#password")
    const showButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Show password"]'
    )

    await act(async () => showButton?.click())

    const hideButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Hide password"]'
    )
    expect(input?.type).toBe("text")
    expect(hideButton?.title).toBe("Hide password")
    expect(hideButton?.getAttribute("aria-pressed")).toBe("true")
    expect(document.activeElement).toBe(input)

    await act(async () => hideButton?.click())

    expect(input?.type).toBe("password")
    expect(
      document.querySelector('button[aria-label="Show password"]')
    ).not.toBeNull()
    expect(document.activeElement).toBe(input)
  })
})
