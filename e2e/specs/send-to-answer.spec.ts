import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"

/**
 * Send to answer: a template goes to two people, each by a link of their own.
 * No email leaves the local stack, so the dialog hands each link back, as it
 * does in production when an email cannot go. One person answers, with a file,
 * once; the other's link is revoked; Submissions says whom the answers came from.
 */
test("sends a template to people by links of their own, takes one set of answers each, and says whom they came from", async ({
  admin,
  browser,
  pageAs,
  tenant,
}) => {
  const title = uniqueName("Sent form")
  await seedTemplate(admin, tenant.organizationId, title, "published")
  const page = await pageAs("owner_admin")
  const actions = page.getByRole("button", { name: `Actions for ${title}` })
  const dialog = page.getByRole("dialog")
  const row = (email: string) => dialog.getByRole("listitem").filter({ hasText: email })
  // Each address takes only a few emails an hour, so each run has its own.
  const run = title.split(" ").pop()
  const ana = `ana.${run}@example.test`
  const ben = `ben.${run}@example.test`

  async function openDialog(): Promise<void> {
    await page.goto(`/templates?q=${encodeURIComponent(title)}`)
    await waitForHydration(actions)
    await actions.click()
    await page.getByRole("menuitem", { name: "Send to answer…" }).click()
    await expect(dialog.getByRole("heading", { name: `Send “${title}” to answer` })).toBeVisible()
  }

  await openDialog()
  // Addresses as people paste them: any case, spaced, and once too often.
  await dialog.getByLabel("Email addresses").fill(` ${ana.toUpperCase()}, ${ben} ${ana}`)
  await dialog.getByRole("button", { name: "Send", exact: true }).click()
  await expect(row(ana).getByText("Sent", { exact: true })).toBeVisible()
  await expect(dialog.getByRole("listitem")).toHaveCount(2)
  const anaLink = await dialog.getByLabel(`Link for ${ana}`).inputValue()
  const benLink = await dialog.getByLabel(`Link for ${ben}`).inputValue()
  expect(anaLink).not.toBe(benLink)

  await dialog.getByRole("button", { name: `Revoke ${ben}'s link` }).click()
  await expect(row(ben).getByText("Revoked", { exact: true })).toBeVisible()

  // The person answering has no account and no session, and answers from a
  // phone of their own: the answering page's limits are per address, and the
  // other specs submit from this machine's.
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${1 + Math.floor(Math.random() * 254)}` },
  })
  const answering = await context.newPage()

  await answering.goto(benLink)
  await expect(answering.getByRole("heading", { name: "Link turned off" })).toBeVisible()

  await answering.goto(anaLink)
  await expect(answering.getByRole("heading", { level: 1, name: title })).toBeVisible()
  await answering.getByLabel("Client reference").fill("ANA-2210")
  // Choosing a file uploads it; there is no second button.
  await answering.getByLabel("Supporting document").setInputFiles({
    buffer: Buffer.from("reference,amount\nANA-2210,120\n"),
    mimeType: "text/csv",
    name: "statement.csv",
  })
  await expect(answering.getByText("statement.csv")).toBeVisible({ timeout: 30_000 })
  await answering.getByRole("button", { name: "Submit" }).click()
  await answering.waitForURL(/\/forms\/.+\/success/)

  // The link was hers, for one set of answers.
  await answering.goto(anaLink)
  await expect(answering.getByRole("heading", { name: "No longer accepting responses" })).toBeVisible()
  await context.close()

  await openDialog()
  await expect(row(ana).getByText("Answered", { exact: true })).toBeVisible()
  await expect(row(ana).getByRole("button")).toHaveCount(0)

  await page.goto(`/submissions?q=${encodeURIComponent(title)}`)
  await expect(page.getByText(`Sent to ${ana}`)).toBeVisible()
})
