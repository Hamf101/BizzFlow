// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { buildRedirect } from "@/lib/form-utils"

import LoginPage from "./login/page"

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllEnvs()
})

async function renderPage(page: Promise<React.ReactNode>): Promise<void> {
  document.body.innerHTML = renderToStaticMarkup(await page)
}

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
