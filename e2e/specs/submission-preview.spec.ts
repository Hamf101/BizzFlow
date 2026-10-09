import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedSubmission, seedTemplate } from "../support/seed"

test("a pause on a submission's title opens its pages beside it, and a tap opens the submission", async ({
  admin,
  hasTouch,
  pageAs,
  tenant,
}) => {
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
  const page = await pageAs("manager")
  await page.goto(`/submissions?q=${encodeURIComponent(title)}`)

  const link = page.getByRole("link", { exact: true, name: title })
  const preview = page.locator('[data-slot="submission-preview"]')
  await waitForHydration(link)

  // Each device proves its own input: a phone has no resting pointer, so a
  // tap goes straight to the submission; a pointer device pauses on the title.
  if (hasTouch) {
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
})
