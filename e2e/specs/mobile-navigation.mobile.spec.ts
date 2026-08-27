import { expect, test } from "../support/fixtures"

test.describe("mobile navigation", () => {
  test("reaches primary and overflow workspace routes without the sidebar", async ({
    pageAs,
  }) => {
    const page = await pageAs("manager")

    await page.goto("/dashboard")

    const navigation = page.getByRole("navigation", {
      name: "Mobile navigation",
    })

    await expect(navigation).toBeVisible()
    await expect(page.locator("aside")).toBeHidden()
    await expect(
      page.getByRole("link", { name: "BizFlow dashboard" })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: /open account menu/i })
    ).toBeVisible()

    await navigation.getByRole("link", { name: "Docs" }).click()
    await expect(page).toHaveURL(/\/documents$/)
    await expect(
      page.getByRole("heading", { level: 1, name: "Documents" })
    ).toBeVisible()

    await navigation.getByRole("button", { name: "More" }).click()
    await expect(
      page.getByRole("heading", { name: "Everything else" })
    ).toBeVisible()
    await page.getByRole("link", { name: "People" }).click()
    await expect(page).toHaveURL(/\/people$/)
    await expect(
      page.getByRole("heading", { level: 1, name: "People" })
    ).toBeVisible()

    await navigation.getByRole("button", { name: "More" }).click()
    await page.getByRole("link", { name: "Submissions" }).click()
    await expect(page).toHaveURL(/\/submissions$/)
    await expect(
      page.getByRole("heading", { level: 1, name: "Submissions" })
    ).toBeVisible()

    await navigation.getByRole("button", { name: "More" }).click()
    await page.getByRole("link", { name: "Audit log" }).click()
    await expect(page).toHaveURL(/\/audit-log$/)
    await expect(
      page.getByRole("heading", { level: 1, name: "Audit Log" })
    ).toBeVisible()
  })
})
