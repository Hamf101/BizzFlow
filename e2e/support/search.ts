import { expect, type Locator, type Page } from "@playwright/test"

import { waitForHydration } from "./hydration"

/**
 * Opens the workspace search from whichever Search button this viewport
 * shows: the sidebar's row, or the phone's magnifier.
 *
 * @param page - A signed-in workspace page.
 * @returns The open search.
 */
export async function openSearch(page: Page): Promise<Locator> {
  const trigger = page.getByRole("button", { name: /^Search/ })
  await waitForHydration(trigger)
  await trigger.click()
  const search = page.getByRole("dialog", { name: "Search" })
  await expect(search).toBeVisible()

  return search
}

/**
 * Searches one list from the workspace search and opens the whole list with
 * the words, as the list's own search box once did.
 *
 * @param page - A signed-in workspace page.
 * @param section - The list's filter, as its tab names it.
 * @param words - What to search for.
 */
export async function searchList(page: Page, section: string, words: string): Promise<void> {
  const search = await openSearch(page)
  await search.getByRole("button", { name: new RegExp(`^${section}`) }).click()
  await search.getByRole("combobox", { name: "Search" }).fill(words)
  await search.getByRole("option", { name: new RegExp(`^Show all \\d+ in ${section}`) }).click()
}
