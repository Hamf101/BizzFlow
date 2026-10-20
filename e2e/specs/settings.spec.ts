import { expect, test } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"

test("a notification switch saves the moment it is flipped, with no Save button to find", async ({ admin, pageAs, tenant }) => {
  const staff = tenant.users.staff
  const emailOn = async (): Promise<boolean> => {
    const row = await admin
      .from("organization_memberships")
      .select("email_notifications_enabled")
      .eq("org_id", tenant.organizationId)
      .eq("user_id", staff.id)
      .single()
    if (row.error) throw row.error
    return row.data.email_notifications_enabled as boolean
  }
  const page = await pageAs("staff")

  try {
    await page.goto("/settings")
    const notifications = page.locator('[data-slot="card"]').filter({ has: page.getByText("Notifications", { exact: true }) })
    const email = notifications.getByRole("switch", { name: "Email" })
    await waitForHydration(email)
    await expect(email).toBeChecked()
    await expect(notifications.getByRole("button", { name: "Save", exact: true })).toHaveCount(0)

    await email.click()
    await expect.poll(emailOn).toBe(false)
    await page.reload()
    await expect(email).not.toBeChecked()
  } finally {
    await admin
      .from("organization_memberships")
      .update({ email_notifications_enabled: true })
      .eq("org_id", tenant.organizationId)
      .eq("user_id", staff.id)
  }
})
