import { expect, type Locator } from "@playwright/test"

/**
 * Waits until React has hydrated an element, so the next interaction reaches
 * its event handlers.
 *
 * Server-rendered markup is visible, and actionable to Playwright, before the
 * client bundle attaches handlers. An interaction that lands in that window is
 * lost: a resting pointer never fires `pointerenter` again, so a hover preview
 * would stay closed on a working page. React marks every hydrated host element
 * with a `__reactProps$` key. That implementation detail is used only to
 * synchronise; if React ever renames it, this wait fails loudly as a timeout.
 *
 * @param locator - Element the spec is about to interact with.
 */
export async function waitForHydration(locator: Locator): Promise<void> {
  await expect
    .poll(
      () =>
        locator.evaluate((element: Element): boolean =>
          Object.keys(element).some((key: string): boolean =>
            key.startsWith("__reactProps$")
          )
        ),
      { message: "React to hydrate the element before the spec interacts with it" }
    )
    .toBe(true)
}
