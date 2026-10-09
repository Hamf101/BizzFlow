import { readFileSync } from "node:fs"

import { expect, test as base, type Page } from "@playwright/test"
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
  // Each test is someone on a device of their own. The app's limits are per
  // address, and one address for the whole suite would spend everyone's sign-in
  // and answering budgets on whichever tests ran first. Contexts a spec opens
  // itself take this too.
  extraHTTPHeaders: async ({}, use) => {
    await use({ "x-forwarded-for": `198.18.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}` })
  },

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

export { expect }

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
  await submitLogin(page, email, password)
  // Someone without a workspace goes on to name one.
  await page.waitForURL(/\/(dashboard|welcome)/)
}

/** Fills the login form and presses Log in, without waiting for where it leads. */
export async function submitLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Log in" }).click()
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

/** A unique address no mail server will ever see, for an account a spec creates. */
export function uniqueEmail(prefix: string): string {
  return `${uniqueName(prefix).toLowerCase().replace(/[^a-z0-9]+/g, "-")}@e2e.bizflow.test`
}

type SavedBlock = { fieldKey: string; id: string; label: string; text?: string; type: string }
type SavedContent = { blocks: SavedBlock[]; branding: Record<string, unknown> }

/**
 * Polls what a document or template has saved until the editor's autosave
 * lands, as `pick` reads it.
 *
 * @param admin - Service-role client.
 * @param relation - Where the content lives: a document's snapshot, a
 *   template's working copy, or its published version.
 * @param id - The record.
 * @param pick - What to compare from the saved content.
 */
export function expectSaved<T>(
  admin: SupabaseClient,
  relation: "documents" | "document_templates" | "published_document_templates",
  id: string,
  pick: (content: SavedContent) => T
) {
  const column = relation === "documents" ? "template_snapshot" : "content"

  return expect.poll(
    async () => {
      const { data, error } = await admin.from(relation).select(column).eq("id", id).single()
      if (error) throw error
      return pick((data as Record<string, SavedContent>)[column])
    },
    { timeout: 15_000 }
  )
}
