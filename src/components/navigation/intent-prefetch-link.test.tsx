import type {
  FocusEvent,
  MouseEvent,
  ReactElement,
  TouchEvent,
} from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { prefetchMock } = vi.hoisted(() => ({
  prefetchMock: vi.fn(),
}))

vi.mock("next/link", () => ({ default: "a" }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: prefetchMock }),
}))

import { IntentPrefetchLink } from "./intent-prefetch-link"

type RenderedLinkProps = {
  onFocus?: (event: FocusEvent<HTMLAnchorElement>) => void
  onMouseEnter?: (event: MouseEvent<HTMLAnchorElement>) => void
  onTouchStart?: (event: TouchEvent<HTMLAnchorElement>) => void
  prefetch?: boolean
}

function getRenderedLinkProps(link: ReactElement): RenderedLinkProps {
  return link.props as RenderedLinkProps
}

describe("IntentPrefetchLink", () => {
  beforeEach(() => {
    prefetchMock.mockClear()
  })

  it("disables viewport prefetch and warms the route after pointer intent", () => {
    const link = IntentPrefetchLink({ children: "People", href: "/people" })
    const props = getRenderedLinkProps(link)

    expect(props.prefetch).toBe(false)

    props.onMouseEnter?.({
      defaultPrevented: false,
    } as MouseEvent<HTMLAnchorElement>)

    expect(prefetchMock).toHaveBeenCalledExactlyOnceWith("/people")
  })

  it.each([
    ["onFocus", {} as FocusEvent<HTMLAnchorElement>],
    ["onTouchStart", {} as TouchEvent<HTMLAnchorElement>],
  ] as const)("warms the route on %s", (handlerName, event) => {
    const link = IntentPrefetchLink({ children: "Tasks", href: "/tasks" })
    const props = getRenderedLinkProps(link)

    props[handlerName]?.(event as never)

    expect(prefetchMock).toHaveBeenCalledExactlyOnceWith("/tasks")
  })

  it("preserves a caller's event handler", () => {
    const onMouseEnter = vi.fn()
    const event = { defaultPrevented: false } as MouseEvent<HTMLAnchorElement>
    const link = IntentPrefetchLink({
      children: "Settings",
      href: "/settings",
      onMouseEnter,
    })
    const props = getRenderedLinkProps(link)

    props.onMouseEnter?.(event)

    expect(onMouseEnter).toHaveBeenCalledExactlyOnceWith(event)
    expect(prefetchMock).toHaveBeenCalledExactlyOnceWith("/settings")
  })
})
