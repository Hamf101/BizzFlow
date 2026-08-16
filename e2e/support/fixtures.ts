import { readFileSync } from "node:fs"

import { test as base, type Page } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"

import { authStatePath, TENANT_STATE_PATH } from "./paths"
import {
  createAdminClient,
  type OrganizationRole,
  type SeededTenant,
} from "./tenant"

/**
 * Shared fixtures for the pilot journeys.
 *
 * Every spec runs against the tenant seeded once in `global.setup.ts`, signed in
 * as whichever role the journey calls for. Opening a page per role rather than
 * re-authenticating mid-test is what keeps the review spec — which needs a staff
 * member and a manager acting in turn — from spending most of its runtime on
 * login forms.
 */

export type TenantFixtures = {
  admin: SupabaseClient
  tenant: SeededTenant
  /** Opens a page already signed in as the given role. */
  pageAs: (role: OrganizationRole) => Promise<Page>
}

export const test = base.extend<TenantFixtures>({
  admin: async ({}, use) => {
    await use(createAdminClient())
  },

  tenant: async ({}, use) => {
    await use(JSON.parse(readFileSync(TENANT_STATE_PATH, "utf8")) as SeededTenant)
  },

  pageAs: async ({ browser }, use) => {
    const opened: Page[] = []

    await use(async (role: OrganizationRole): Promise<Page> => {
      const context = await browser.newContext({
        storageState: authStatePath(role),
      })
      const page = await context.newPage()

      opened.push(page)

      return page
    })

    for (const page of opened) {
      await page.context().close()
    }
  },
})

export { expect } from "@playwright/test"

/**
 * Signs a user in through the login form.
 *
 * Used by specs that need an actor the fixture did not seed — an invitee, for
 * example — where no cached storage state exists.
 *
 * @param page - Page in a context with no session.
 * @param email - Account address.
 * @param password - Account password.
 * @returns Resolves once the dashboard is reached.
 */
export async function signInAs(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(/\/dashboard/)
}

/**
 * Builds a name that is unique to one test run.
 *
 * Specs share a tenant and run in parallel, so every record a spec creates has
 * to be findable without matching a neighbour's. A plain "Test template" would
 * match three rows on the second run.
 *
 * @param prefix - Human-readable prefix kept for debuggability.
 * @returns A unique label.
 */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}
