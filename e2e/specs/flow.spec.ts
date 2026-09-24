import { expect, test } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"

test("Flow is one press away on every workspace page", async ({ pageAs }, testInfo) => {
  const page = await pageAs("staff")
  if (testInfo.project.use.viewport) {
    await page.setViewportSize(testInfo.project.use.viewport)
  }
  const launcher = page.locator('[data-slot="flow-launcher"]')

  for (const path of ["/dashboard", "/documents", "/tasks"]) {
    await page.goto(path)
    await waitForHydration(launcher)
    await launcher.click()
    await expect(page.getByRole("dialog", { name: "Flow" }).getByLabel("Ask Flow")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: "Flow" })).toBeHidden()
  }

  // On a phone it floats above the tab bar, never on top of a tab.
  const tabs = page.getByRole("navigation", { name: "Mobile navigation" })
  if (await tabs.isVisible()) {
    const button = await launcher.boundingBox()
    const bar = await tabs.boundingBox()
    expect(button && bar && button.y + button.height).toBeLessThanOrEqual(bar?.y ?? 0)
  }
})
