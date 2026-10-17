import { randomUUID } from "node:crypto"

import type { Browser, Page } from "@playwright/test"

import { expect, signInAs, test } from "../support/fixtures"
import { createAdminClient, destroyTenant, insertMember, type SeededTenant, type SeededUser, seedTenant } from "../support/tenant"

// Its own workspace: placing someone in a team changes what they see, which
// must never reach the specs sharing the common tenant.
let tenant: SeededTenant
let blair: SeededUser

test.beforeAll(async () => {
  const admin = createAdminClient()
  const label = `team-${randomUUID().slice(0, 8)}`
  tenant = await seedTenant(admin, label)
  blair = await insertMember(admin, tenant.organizationId, "staff", `${label}-b`, {
    email: `blair-${label}@e2e.bizflow.test`,
    fullName: "Blair Unplaced",
  })
})

test.afterAll(async () => {
  if (tenant) await destroyTenant(createAdminClient(), tenant)
})

async function as(browser: Browser, user: SeededUser): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await signInAs(page, user.email, user.password)
  return page
}

test("an owner puts someone in a team, and from then on they see their team, not everyone", async ({ browser }) => {
  const staff = tenant.users.staff
  const owner = await as(browser, tenant.users.owner_admin)
  const teams = owner.getByRole("region", { name: "Teams" })

  await owner.goto("/settings")
  await teams.getByRole("textbox", { name: "New team" }).fill("Ops")
  await teams.getByRole("button", { name: "Add" }).last().click()
  await expect(teams.getByRole("textbox", { name: "Team name" })).toHaveValue("Ops")
  await teams.getByRole("combobox", { name: "Add someone to Ops" }).click()
  await owner.getByRole("option", { name: "E2E staff" }).click()
  await expect(teams.getByRole("button", { name: "Make E2E staff lead Ops" })).toBeVisible()

  // Placed, the staff member sees their team; Blair, placed nowhere, everyone.
  const placed = await as(browser, staff)
  await placed.goto("/people")
  const placedList = placed.getByRole("main")
  await expect(placedList.getByText("E2E staff").first()).toBeVisible()
  await expect(placedList.getByText("Blair Unplaced")).toHaveCount(0)
  await expect(placedList.getByText("E2E manager")).toHaveCount(0)

  const unplaced = await as(browser, blair)
  await unplaced.goto("/people")
  await expect(unplaced.getByRole("main").getByText("E2E manager").first()).toBeVisible()

  // Widening staff to everyone gives the placed member everyone back.
  await owner.getByRole("combobox", { name: "What Staff sees" }).click()
  await owner.getByRole("option", { name: "Everyone" }).click()
  await expect(owner.getByRole("combobox", { name: "What Staff sees" })).toContainText("Everyone")
  await placed.reload()
  await expect(placedList.getByText("Blair Unplaced").first()).toBeVisible()
})
