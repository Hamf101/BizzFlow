// @vitest-environment jsdom

import { act } from "react"
import { expect, it, vi } from "vitest"

vi.mock("next/link", async () => {
  const { createElement } = await import("react")

  return {
    // Shows what the link asks Next.js to load ahead.
    default: ({ prefetch, ...props }: { prefetch?: boolean }) =>
      createElement("a", { ...props, "data-prefetch": String(prefetch) }),
  }
})

import { IntentPrefetchLink } from "./intent-prefetch-link"
import { mount } from "@/test/render"

async function renderLink(onMouseEnter = vi.fn()): Promise<HTMLAnchorElement> {
  const container = document.body.appendChild(document.createElement("div"))

  await act(async () =>
    mount(container).render(
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
