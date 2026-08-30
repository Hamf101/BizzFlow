import { readFileSync } from "node:fs"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  usePathname: () => "/documents",
}))

import { PostHogProvider } from "./posthog-provider"

describe("PostHogProvider", () => {
  it("renders product content immediately without an analytics placeholder", () => {
    const markup = renderToStaticMarkup(
      <PostHogProvider userId="user-1">
        <main>Documents workspace</main>
      </PostHogProvider>
    )

    expect(markup).toBe("<main>Documents workspace</main>")
  })

  it("has no eager client import or human-readable query-message mapping", () => {
    const providerSource = readFileSync(
      new URL("./posthog-provider.tsx", import.meta.url),
      "utf8"
    )
    const lifecycleSource = readFileSync(
      new URL("../../lib/posthog.ts", import.meta.url),
      "utf8"
    )

    expect(lifecycleSource).not.toMatch(
      /import\s+posthog\s+from\s+["']posthog-js["']/
    )
    expect(lifecycleSource).toContain('import("posthog-js")')
    expect(providerSource).not.toContain("useSearchParams")
    expect(providerSource).not.toContain("Template created.")
    expect(providerSource).not.toContain("Submission submitted.")
  })
})
