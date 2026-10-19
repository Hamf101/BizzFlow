// @vitest-environment jsdom
import { act, Suspense } from "react"
import { expect, it, vi } from "vitest"

import { mount } from "@/test/render"

import { DESIGN_TOOLS } from "./design-tools-provided"

// The App Router's next/dynamic, as the editor gets it in the app.
vi.mock("next/dynamic", async () => ({ default: (await import("next/dist/shared/lib/app-dynamic")).default }))

it("keeps the page shown, and typed in, while the slash menu is still loading", () => {
  const { SlashMenu } = DESIGN_TOOLS
  const root = mount()
  const page = (slash: boolean) => (
    // The route's loading screen stands above the whole editor.
    <Suspense fallback={<p>Opening</p>}>
      <div data-testid="line" />
      {slash ? <SlashMenu activeIndex={0} anchor={new DOMRect()} choices={[]} onChoose={vi.fn()} onHover={vi.fn()} /> : null}
    </Suspense>
  )

  act(() => root.render(page(false)))
  act(() => root.render(page(true)))

  expect(document.body.textContent).not.toContain("Opening")
  expect(document.querySelector<HTMLElement>('[data-testid="line"]')?.style.display).not.toBe("none")
})
