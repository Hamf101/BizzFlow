// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { buildRedirect } from "@/lib/form-utils"

import LoginPage from "./login/page"
import SignupPage from "./signup/page"

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllEnvs()
})

async function renderPage(page: Promise<React.ReactNode>): Promise<void> {
  document.body.innerHTML = renderToStaticMarkup(await page)
}

describe("authentication page language", () => {
  it("uses Log in and Sign up on the login page", async () => {
    await renderPage(LoginPage({ searchParams: Promise.resolve({}) }))

    expect(document.querySelector("h1")?.textContent).toBe("Log in to BizFlow")
    expect(
      document.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.textContent
    ).toBe("Log in")
    expect(document.querySelector<HTMLAnchorElement>('a[href="/signup"]')?.textContent).toBe(
      "Sign up"
    )
    expect(document.body.textContent).not.toMatch(/Sign in|Create account/)
    expect(
      document.querySelector('button[aria-label="Show password"]')
    ).not.toBeNull()
  })

  it("uses Sign up and Log in on the signup page", async () => {
    await renderPage(SignupPage({ searchParams: Promise.resolve({}) }))

    expect(document.querySelector("h1")?.textContent).toBe("Sign up for BizFlow")
    expect(
      document.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.textContent
    ).toBe("Sign up")
    expect(document.querySelector<HTMLAnchorElement>('a[href="/login"]')?.textContent).toBe(
      "Log in"
    )
    expect(document.body.textContent).not.toMatch(/Sign in|Create account/)
    expect(
      document.querySelector('button[aria-label="Show password"]')
    ).not.toBeNull()
  })
})

describe("feedback carried in the address", () => {
  it("shows an error the app redirected with, but not one an attacker wrote into a link", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret-key")
    const appRedirect = new URL(
      buildRedirect("/login", { error: "Invalid email or password." }),
      "https://app.test"
    )
    const forged = "Your account is locked. Call +1 555 0100 to unlock it."

    await renderPage(
      LoginPage({ searchParams: Promise.resolve(Object.fromEntries(appRedirect.searchParams)) })
    )
    expect(document.body.textContent).toContain("Invalid email or password.")

    await renderPage(LoginPage({ searchParams: Promise.resolve({ error: forged }) }))
    expect(document.body.textContent).not.toContain(forged)

    await renderPage(
      LoginPage({
        searchParams: Promise.resolve({
          ...Object.fromEntries(appRedirect.searchParams),
          error: forged,
        }),
      })
    )
    expect(document.body.textContent).not.toContain(forged)
  })
})
