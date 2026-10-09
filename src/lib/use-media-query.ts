import { useCallback, useSyncExternalStore } from "react"

/**
 * Whether a media query matches, following it as it changes.
 *
 * @param query - The media query.
 * @param serverValue - What the server, which has no window, assumes.
 * @returns Whether it matches.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      const list = window.matchMedia(query)
      list.addEventListener("change", onChange)
      return () => list.removeEventListener("change", onChange)
    },
    [query]
  )

  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => serverValue)
}
