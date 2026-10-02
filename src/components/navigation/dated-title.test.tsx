// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { expect, it, vi } from "vitest"

import { DatedTitle } from "./dated-title"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it("puts the reader's date with its year under the title, leaves the server's guess out, and turns over at midnight", () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 28, 23, 59, 30))
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  try {
    // The server's clock can sit in another time zone, so its page carries no date at all.
    expect(renderToString(<DatedTitle><h1>Files</h1></DatedTitle>)).not.toMatch(/2026/)
    act(() => root.render(<DatedTitle><h1>Files</h1></DatedTitle>))
    expect(host.querySelector("h1 + p")?.textContent).toBe("Monday, September 28, 2026")
    act(() => vi.advanceTimersByTime(60_000))
    expect(host.querySelector("h1 + p")?.textContent).toBe("Tuesday, September 29, 2026")
  } finally {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  }
})
