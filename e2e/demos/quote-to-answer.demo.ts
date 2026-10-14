import { randomUUID } from "node:crypto"

import { chooseOption } from "../support/choose"
import { expect, test } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"
import { DEMO_TENANT } from "../support/tenant"
import { beat, caption, typeLikeAPerson } from "./support/demo"

const QUOTE = "Boiler replacement quote"
const CUSTOMER = "jordan.reyes@example.test"

// A day from today, as the app's calendar marks it (local time, YYYY-MM-DD).
function daysFromNow(days: number): string {
  const day = new Date()
  day.setDate(day.getDate() + days)
  return [day.getFullYear(), day.getMonth() + 1, day.getDate()].map((part) => String(part).padStart(2, "0")).join("-")
}

/**
 * Quote → Send to answer → the customer answers → a job is assigned and
 * reminded. Northside Plumbing's owner sends a quote, the customer accepts it
 * from a link with no account, and the owner hands the install to an engineer
 * with a reminder. One page plays both sides, so the video is one take.
 */
test("a quote goes out, comes back accepted, and becomes an assigned, reminded job", async ({ admin, pageAs, tenant }) => {
  const text = (fieldKey: string, label: string) => ({
    fieldKey, helpText: null, id: randomUUID(), label, multiline: false, placeholder: null, required: true, type: "text_field",
  })
  await seedTemplate(admin, tenant.organizationId, QUOTE, "published", [
    { alignment: "left", id: randomUUID(), level: 2, text: "Your quote from Northside Plumbing", type: "heading" },
    { alignment: "left", id: randomUUID(), text: "Remove the old boiler and fit a new A-rated combi boiler, with a magnetic filter and a smart thermostat. Fixed price £2,480, including parts, labour and a 10-year warranty.", type: "paragraph" },
    text("full_name", "Your full name"),
    text("install_day", "Which day suits you for the install?"),
    { checkedByDefault: false, fieldKey: "accepted", helpText: null, id: randomUUID(), label: "I accept this quote", required: false, type: "checkbox_field" },
  ])
  const page = await pageAs("owner_admin")
  const dialog = page.getByRole("dialog")
  const actions = page.getByRole("button", { name: `Actions for ${QUOTE}` })

  // 1. The owner sends the quote.
  await page.goto("/templates")
  await caption(page, "Maya runs Northside Plumbing. A customer wants a new boiler.")
  await caption(page, "Her quote is a ready-made form: price, terms, and what she needs back.")
  await waitForHydration(actions)
  await actions.click()
  await page.getByRole("menuitem", { name: "Send to answer…" }).click()
  await caption(page, "She sends it to the customer to answer.")
  await typeLikeAPerson(dialog.getByLabel("Email addresses"), CUSTOMER)
  await dialog.getByRole("button", { name: "Send", exact: true }).click()
  await expect(dialog.getByRole("listitem").filter({ hasText: CUSTOMER }).getByText("Sent", { exact: true })).toBeVisible()
  await caption(page, "The customer gets a link of their own. It works once.")
  const link = await dialog.getByLabel(`Link for ${CUSTOMER}`).inputValue()

  // 2. The customer answers, signed out: no account, no app.
  const owner = await page.context().cookies()
  await page.context().clearCookies()
  await page.goto(link)
  await expect(page.getByRole("heading", { level: 1, name: QUOTE })).toBeVisible()
  await caption(page, "Jordan, the customer, opens the link on any device. No account needed.")
  await typeLikeAPerson(page.getByLabel("Your full name"), "Jordan Reyes")
  await typeLikeAPerson(page.getByLabel("Which day suits you for the install?"), "Any weekday morning")
  await page.getByLabel("I accept this quote").check()
  await caption(page, "Jordan accepts the quote and submits.")
  await page.getByRole("button", { name: "Submit" }).click()
  await page.waitForURL(/\/forms\/.+\/success/)
  await beat(page)

  // 3. Back with the owner: the answer is in.
  await page.context().addCookies(owner)
  await page.goto(`/submissions?q=${encodeURIComponent(QUOTE)}`)
  await caption(page, "Back at Northside, the accepted quote is waiting in Submissions.")
  await page.getByRole("link", { name: QUOTE }).first().click()
  await expect(page.getByText("Jordan Reyes").first()).toBeVisible()
  await caption(page, "Every answer is there, with who sent it and when.")

  // 4. The job goes to an engineer, with a due date.
  await caption(page, "Maya turns it into a job for Sam, her engineer.")
  const newTask = page.locator("form").filter({ has: page.getByRole("button", { name: "Create task" }) })
  await page.getByText("New task from this submission").click()
  await typeLikeAPerson(newTask.getByLabel("Title"), "Fit the new boiler for Jordan Reyes")
  await newTask.getByLabel("Due", { exact: true }).click()
  await page.locator(`[data-day="${daysFromNow(2)}"]`).click()
  await newTask.getByLabel("Time").fill("09:00")
  await chooseOption(newTask.getByLabel("Assignee"), DEMO_TENANT.memberNames.staff)
  await caption(page, "Sam is emailed the job the moment it's his.")
  await page.getByRole("button", { name: "Create task" }).click()
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}/)

  // 5. And reminded, so nothing slips.
  await caption(page, "And a reminder, the day before, so nothing slips.")
  const reminder = page.locator("form").filter({ has: page.getByRole("button", { name: "Schedule reminder" }) })
  await reminder.getByLabel("Remind at").click()
  await page.locator(`[data-day="${daysFromNow(1)}"]`).click()
  await reminder.getByLabel("Time").fill("08:00")
  await reminder.getByRole("button", { name: "Schedule reminder" }).click()
  await expect(page.getByText("Pending").first()).toBeVisible()
  await caption(page, "Quote sent, accepted, booked and reminded — in a couple of minutes.")
  await caption(page, "")
})
