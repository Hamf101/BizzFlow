// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"

vi.mock("next/link", async () => {
  const { createElement } = await import("react")

  return {
    // Shows what the link asks Next.js to load ahead.
    default: ({ prefetch, ...props }: { prefetch?: boolean }) =>
      createElement("a", { ...props, "data-prefetch": String(prefetch) }),
  }
})

import { IntentPrefetchLink } from "./intent-prefetch-link"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.replaceChildren()
})

async function renderLink(onMouseEnter = vi.fn()): Promise<HTMLAnchorElement> {
  const container = document.body.appendChild(document.createElement("div"))

  await act(async () =>
    createRoot(container).render(
      <IntentPrefetchLink href="/people" onMouseEnter={onMouseEnter}>
        People
      </IntentPrefetchLink>
    )
  )

  return container.querySelector("a") as HTMLAnchorElement
}

it.each([
  ["hovered", new MouseEvent("mouseover", { bubbles: true })],
  ["focused", new FocusEvent("focusin", { bubbles: true })],
  ["touched", new Event("touchstart", { bubbles: true })],
])("loads nothing ahead until the link is %s, then the whole route", async (_intent, event) => {
  const link = await renderLink()
  expect(link.dataset.prefetch).toBe("false")

  act(() => {
    link.dispatchEvent(event)
  })

  expect(link.dataset.prefetch).toBe("true")
})

it("still runs a caller's own handler", async () => {
  const onMouseEnter = vi.fn()
  const link = await renderLink(onMouseEnter)

  act(() => {
    link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
  })

  expect(onMouseEnter).toHaveBeenCalledOnce()
})
