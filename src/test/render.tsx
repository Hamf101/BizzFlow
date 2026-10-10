import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach } from "vitest"

// Tells React these tests drive it through act().
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Root[] = []

afterEach(() => {
  for (const root of mounted.splice(0)) {
    act(() => root.unmount())
  }
  document.body.replaceChildren()
})

/**
 * Makes a React root that is unmounted, with the page cleared, after the test.
 *
 * @param host - Where it draws; a new element at the end of the page by default.
 * @returns The root.
 */
export function mount(host: Element = document.body.appendChild(document.createElement("div"))): Root {
  const root = createRoot(host)
  mounted.push(root)
  return root
}
