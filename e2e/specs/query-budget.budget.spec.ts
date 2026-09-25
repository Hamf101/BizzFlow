import { expect, test } from "../support/fixtures"
import { countDatabaseRequests, resetStatements } from "../support/statements"

// Database requests each page may make, both for its own render and for a real
// visit with everything the browser asks for afterwards; tabs on screen load
// nothing ahead. Fewer is always fine. More fails here, so another query on
// every page view is a decision rather than an accident.
const BUDGETS: Record<string, number> = {
  "/dashboard": 28,
  "/documents": 13,
  "/submissions": 10,
  "/tasks": 10,
  "/templates": 8,
  "/people": 8,
  "/settings": 5,
  "/audit-log": 10,
}

test("workspace pages stay within their database budgets", async ({ pageAs }) => {
  test.setTimeout(180_000)
  const page = await pageAs("manager")
  const over: string[] = []

  for (const [path, budget] of Object.entries(BUDGETS)) {
    resetStatements()
    expect((await page.request.get(path)).ok()).toBe(true)
    // Work a render schedules after its response lands in its own count.
    await page.waitForTimeout(400)
    const render = countDatabaseRequests()

    resetStatements()
    await page.goto(path)
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(600)
    const visit = countDatabaseRequests()

    if (render > budget || visit > budget) {
      over.push(`${path}: render ${render}, visit ${visit}, budget ${budget}`)
    }
  }

  expect(over).toEqual([])
})
