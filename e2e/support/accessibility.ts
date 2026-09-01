import AxeBuilder from "@axe-core/playwright"
import { expect, type Locator, type Page } from "@playwright/test"

const ACTIONABLE_IMPACTS = new Set(["moderate", "serious", "critical"])

type TargetBox = {
  bottom: number
  height: number
  label: string
  left: number
  right: number
  top: number
  width: number
}

/**
 * Runs axe against the current synthetic page and fails on every non-minor finding.
 *
 * Serious and critical findings are blocking by contract. Moderate findings also
 * fail here so they must be fixed or moved into an explicit, owned evidence row
 * rather than disappearing behind a global rule exclusion.
 *
 * @param page - Loaded Playwright page to audit.
 * @returns Resolves when no actionable axe violation remains.
 */
export async function expectNoActionableAxeViolations(
  page: Page
): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze()
  const actionable = results.violations.filter((violation) =>
    ACTIONABLE_IMPACTS.has(violation.impact ?? "")
  )
  const details = actionable.map((violation) => ({
    help: violation.help,
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target),
  }))

  expect(details, "Actionable axe violations must be fixed or explicitly owned").toEqual(
    []
  )
}

/**
 * Verifies the route exposes one primary heading inside a main landmark.
 *
 * @param page - Loaded route under test.
 * @returns Resolves when the landmark and heading contract holds.
 */
export async function expectPrimaryRouteSemantics(page: Page): Promise<void> {
  await expect(page.getByRole("main")).toHaveCount(1)
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)
}

/**
 * Tabs to the first visible interactive element and proves its focus treatment is visible.
 *
 * @param page - Loaded page using keyboard modality.
 * @returns Resolves after a visible focus target and indicator are found.
 */
export async function expectVisibleKeyboardFocus(page: Page): Promise<void> {
  let focused: Locator | null = null

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.keyboard.press("Tab")
    const candidate = page.locator(":focus")

    if (await candidate.isVisible()) {
      focused = candidate
      break
    }
  }

  expect(focused, "Keyboard traversal must reach a visible focus target").not.toBeNull()
  await expect(focused!).toBeVisible()

  const hasVisibleIndicator = await focused!.evaluate((element) => {
    const style = window.getComputedStyle(element)
    const outlineVisible =
      style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0
    const ringVisible = style.boxShadow !== "none"

    return outlineVisible || ringVisible
  })

  expect(hasVisibleIndicator, "The keyboard-focused control needs a visible outline or ring").toBe(
    true
  )
}

/**
 * Measures visible standalone controls and proves their hit regions are large and separate.
 *
 * @param targets - Locator resolving to the standalone controls in one control group.
 * @returns Resolves when every target is at least 44×44 CSS pixels and no boxes overlap.
 */
export async function expectStandaloneTargets(
  targets: Locator
): Promise<void> {
  const layoutRoundingTolerancePx = 0.01
  const boxes = await targets.evaluateAll((elements): TargetBox[] =>
    elements.flatMap((element): TargetBox[] => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()

      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        rect.width === 0 ||
        rect.height === 0
      ) {
        return []
      }

      return [
        {
          bottom: rect.bottom,
          height: rect.height,
          label:
            element.getAttribute("aria-label") ??
            element.textContent?.trim() ??
            element.tagName.toLowerCase(),
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
        },
      ]
    })
  )

  expect(boxes.length, "The target group must contain visible controls").toBeGreaterThan(0)

  for (const box of boxes) {
    expect(
      box.width + layoutRoundingTolerancePx,
      `${box.label} target width`
    ).toBeGreaterThanOrEqual(44)
    expect(
      box.height + layoutRoundingTolerancePx,
      `${box.label} target height`
    ).toBeGreaterThanOrEqual(44)
  }

  const overlaps: string[] = []

  for (let first = 0; first < boxes.length; first += 1) {
    for (let second = first + 1; second < boxes.length; second += 1) {
      const a = boxes[first]
      const b = boxes[second]

      if (!a || !b) {
        continue
      }

      const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)

      if (overlapWidth > 0.5 && overlapHeight > 0.5) {
        overlaps.push(`${a.label} overlaps ${b.label}`)
      }
    }
  }

  expect(overlaps, "Standalone control hit regions must not overlap").toEqual([])
}
