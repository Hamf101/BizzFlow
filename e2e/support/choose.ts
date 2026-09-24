import type { Locator } from "@playwright/test"

import { waitForHydration } from "./hydration"

/**
 * Picks a choice in one of the app's selects. They open a themed list of
 * their own rather than the platform's menu, so Playwright's `selectOption`
 * does not apply; the choice is pressed by its visible name instead.
 *
 * @param select - The select's button, found by its label.
 * @param choice - The choice's name, or part of it.
 */
export async function chooseOption(select: Locator, choice: string | RegExp): Promise<void> {
  await waitForHydration(select)
  await select.click()
  await select.page().getByRole("option", { name: choice }).click()
}
