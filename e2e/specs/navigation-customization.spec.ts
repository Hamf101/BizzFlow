import { test, expect, signInAs, uniqueName } from "../support/fixtures"
import { seedTenant, destroyTenant } from "../support/tenant"

// Each run owns a workspace because renaming changes what every member sees.
test("owner names are shared while drag order stays personal and survives a new session", async ({ browser, admin }) => {
  const tenant = await seedTenant(admin)
  const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const staffContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  try {
    const owner = await ownerContext.newPage()
    await signInAs(owner, tenant.users.owner_admin.email, tenant.users.owner_admin.password)
    const ownerNav = owner.getByRole("navigation", { name: "Primary navigation", exact: true })
    const name = uniqueName("Client files")
    await ownerNav.getByRole("link", { name: "Files", exact: true }).click({ button: "right" })
    await owner.getByRole("menuitem", { name: "Rename", exact: true }).click()
    await owner.getByRole("textbox", { name: "Tab name", exact: true }).fill(name)
    await owner.getByRole("button", { name: "Save name", exact: true }).click()
    await expect(owner.getByRole("dialog")).toHaveCount(0)
    await expect(ownerNav.getByRole("link", { name, exact: true })).toHaveAttribute("href", "/documents")

    const staff = await staffContext.newPage()
    await signInAs(staff, tenant.users.staff.email, tenant.users.staff.password)
    const staffNav = staff.getByRole("navigation", { name: "Primary navigation", exact: true })
    await expect(staffNav.getByRole("link", { name, exact: true })).toBeVisible()
    await staffNav.getByRole("link", { name, exact: true }).click({ button: "right" })
    await expect(staff.getByRole("menuitem", { name: "Rename", exact: true })).toHaveCount(0)
    await staff.keyboard.press("Escape")
    await staffNav.getByRole("link", { name: "Settings", exact: true }).dragTo(staffNav.getByRole("link", { name: "Dashboard", exact: true }))
    await expect(staff.getByRole("status")).toHaveCount(0)
    await expect(staffNav.getByRole("link").first()).toHaveAttribute("href", "/settings")
    await staff.reload()
    await expect(staffNav.getByRole("link").first()).toHaveAttribute("href", "/settings")
    await owner.reload()
    await expect(ownerNav.getByRole("link").first()).toHaveAttribute("href", "/dashboard")

    // A fresh browser context has no local storage: persistence must be on the account.
    const freshContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    try {
      const fresh = await freshContext.newPage()
      await signInAs(fresh, tenant.users.staff.email, tenant.users.staff.password)
      await expect(fresh.getByRole("navigation", { name: "Primary navigation", exact: true }).getByRole("link").first()).toHaveAttribute("href", "/settings")
      await fresh.setViewportSize({ width: 390, height: 844 })
      const mobile = fresh.getByRole("navigation", { name: "Mobile navigation", exact: true })
      await expect(mobile.getByRole("link").first()).toHaveAttribute("href", "/settings")
      await expect(mobile.getByRole("link", { name, exact: true })).toHaveAttribute("href", "/documents")
    } finally {
      await freshContext.close()
    }
  } finally {
    await ownerContext.close()
    await staffContext.close()
    await destroyTenant(admin, tenant)
  }
})
