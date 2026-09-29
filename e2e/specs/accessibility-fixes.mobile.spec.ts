import { expect, test } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"

test("the More button says whether its sheet is open", async ({ pageAs }) => {
  const page = await pageAs("staff")

  await page.goto("/dashboard")

  // Found by markup: while the sheet is open the page behind it is hidden from role queries.
  const more = page.locator('nav[aria-label="Mobile navigation"] button', { hasText: "More" })
  await waitForHydration(more)
  await expect(more).toHaveAttribute("aria-expanded", "false")
  await more.click()
  await expect(more).toHaveAttribute("aria-expanded", "true")
  await page.getByRole("button", { name: "Close navigation" }).click()
  await expect(more).toHaveAttribute("aria-expanded", "false")
})
