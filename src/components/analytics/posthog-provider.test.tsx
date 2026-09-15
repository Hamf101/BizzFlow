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
})
