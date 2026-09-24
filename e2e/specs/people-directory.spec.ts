import type { Browser, Page, TestInfo } from "@playwright/test"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { authStatePath } from "../support/paths"

/**
 * Opens People as the Owner with the project's real device settings.
 *
 * `pageAs` creates a bare context, so a phone project would otherwise run with
 * a desktop viewport and no touch input; this spec needs both to be genuine.
 */
async function openPeopleAsOwner(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const device = testInfo.project.use
  const context = await browser.newContext({
    baseURL: device.baseURL ?? process.env.NEXT_PUBLIC_APP_URL,
    deviceScaleFactor: device.deviceScaleFactor,
    hasTouch: device.hasTouch,
    isMobile: device.isMobile,
    storageState: authStatePath("owner_admin"),
    userAgent: device.userAgent,
    viewport: device.viewport,
  })
  const page = await context.newPage()
  await page.goto("/people")
  await expect(page.getByRole("heading", { name: /People/ })).toBeVisible()
  await waitForHydration(page.locator('[data-slot="member-profile-trigger"]').first())
  return page
}

async function firstMemberPreview(page: Page) {
  const trigger = page.locator('[data-slot="member-profile-trigger"]').first()
  const name = (await trigger.textContent())?.trim() ?? ""
  const preview = page.locator(
    `[data-slot="member-profile-content"][aria-label="Profile for ${name}"]`
  )
  return { preview, trigger }
}

test.describe("People directory", () => {
  test("opens a member preview after a deliberate hover every time and at once on focus, or at once on tap", async ({
    browser,
  }, testInfo) => {
    const page = await openPeopleAsOwner(browser, testInfo)

    try {
      const { preview, trigger } = await firstMemberPreview(page)

      // Each device project proves its own input: a phone has no hover, so it
      // taps; a pointer device hovers twice and then uses the keyboard.
      if (testInfo.project.use.hasTouch) {
        const tappedAt = Date.now()
        await trigger.tap()
        await expect(preview).toBeVisible()
        expect(Date.now() - tappedAt).toBeLessThan(800)
        await expect(preview).toContainText("@")
        return
      }

      for (const attempt of [1, 2]) {
        await page.mouse.move(0, 0)
        await expect(preview).toBeHidden()
        const hoveredAt = Date.now()
        await trigger.hover()
        await expect(preview).toBeVisible()
        expect(Date.now() - hoveredAt, `hover attempt ${attempt}`).toBeGreaterThanOrEqual(800)
      }

      await page.mouse.move(0, 0)
      await expect(preview).toBeHidden()
      const focusedAt = Date.now()
      await trigger.focus()
      await expect(preview).toBeVisible()
      expect(Date.now() - focusedAt).toBeLessThan(800)
      await page.keyboard.press("Escape")
      await expect(preview).toBeHidden()
    } finally {
      await page.context().close()
    }
  })

  test("keeps the open-bottom outline and fits the viewport", async ({ browser }, testInfo) => {
    const page = await openPeopleAsOwner(browser, testInfo)

    try {
      const outline = page.locator("main", { has: page.locator('[data-slot="people-workspace"]') })
      const borders = await outline.evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          bottom: style.borderBottomWidth,
          left: style.borderLeftWidth,
          right: style.borderRightWidth,
          top: style.borderTopWidth,
        }
      })

      expect(borders).toEqual({ bottom: "0px", left: "1px", right: "1px", top: "1px" })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true)
    } finally {
      await page.context().close()
    }
  })

  test("names an existing-member error, keeps dialog focus accessible, and succeeds on retry", async ({
    admin,
    browser,
    tenant,
  }, testInfo) => {
    const page = await openPeopleAsOwner(browser, testInfo)
    const inviteeEmail = `${uniqueName("invitee").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}@example.test`

    try {
      const inviteButton = page.getByRole("button", { name: "Invite", exact: true })
      const dialog = page.getByRole("dialog", { name: "Invite people" })

      await waitForHydration(inviteButton)
      await inviteButton.click()
      await expect(dialog).toBeVisible()
      await expect
        .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true)
      await page.keyboard.press("Escape")
      await expect(dialog).toBeHidden()
      await expect(inviteButton).toBeFocused()

      await inviteButton.click()
      await dialog.getByLabel("Email address").fill(tenant.users.staff.email)
      await dialog.getByRole("button", { name: "Send invite" }).click()
      await expect(
        page.getByRole("status").filter({ hasText: "That person is already a member" })
      ).toBeVisible()

      await inviteButton.click()
      await dialog.getByLabel("Email address").fill(inviteeEmail)
      await dialog.getByRole("button", { name: "Send invite" }).click()
      await expect(
        page.getByRole("status").filter({ hasText: /Invite (email sent|created)/ })
      ).toBeVisible()

      await inviteButton.click()
      await dialog.getByRole("tab", { name: /Manage invites/ }).click()
      await expect(dialog.getByText(inviteeEmail)).toBeVisible()
    } finally {
      await admin
        .from("invites")
        .update({ status: "revoked" })
        .eq("org_id", tenant.organizationId)
        .eq("email", inviteeEmail)
      await page.context().close()
    }
  })
})
