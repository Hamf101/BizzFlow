import type { Browser, Page, TestInfo } from "@playwright/test"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { authStatePath } from "../support/paths"
import { seedSubmission, seedTemplate } from "../support/seed"

/**
 * Opens one search of Submissions as a manager with the project's real device
 * settings.
 *
 * `pageAs` creates a bare context, so a phone project would otherwise run with
 * a desktop viewport and no touch input; this spec needs both to be genuine.
 */
async function openSubmissionsAsManager(
  browser: Browser,
  testInfo: TestInfo,
  query: string
): Promise<Page> {
  const device = testInfo.project.use
  const context = await browser.newContext({
    baseURL: device.baseURL ?? process.env.NEXT_PUBLIC_APP_URL,
    deviceScaleFactor: device.deviceScaleFactor,
    hasTouch: device.hasTouch,
    isMobile: device.isMobile,
    storageState: authStatePath("manager"),
    userAgent: device.userAgent,
    viewport: device.viewport,
  })
  const page = await context.newPage()
  await page.goto(`/submissions?q=${encodeURIComponent(query)}`)
  return page
}

test("a pause on a submission's title opens its pages beside it, and a tap opens the submission", async ({
  admin,
  browser,
  tenant,
}, testInfo) => {
  const template = await seedTemplate(
    admin,
    tenant.organizationId,
    uniqueName("Preview template"),
    "published"
  )
  const title = uniqueName("Preview run")
  const submissionId = await seedSubmission(
    admin,
    tenant.organizationId,
    template,
    title,
    tenant.users.staff.id
  )
  const page = await openSubmissionsAsManager(browser, testInfo, title)

  try {
    const link = page.getByRole("link", { name: title })
    const preview = page.locator('[data-slot="submission-preview"]')
    await waitForHydration(link)

    // Each device proves its own input: a phone has no resting pointer, so a
    // tap goes straight to the submission; a pointer device pauses on the title.
    if (testInfo.project.use.hasTouch) {
      await link.tap()
      await expect(page).toHaveURL(new RegExp(`/submissions/${submissionId}$`))
      return
    }

    await link.hover()
    // The pages show the submission's own answers, loaded for this member.
    await expect(preview).toBeVisible()
    await expect(preview).toContainText("REF-4417")

    await page.mouse.move(0, 0)
    await expect(preview).toBeHidden()
  } finally {
    await page.context().close()
  }
})
