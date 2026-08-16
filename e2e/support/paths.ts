import { resolve } from "node:path"

import type { OrganizationRole } from "./tenant"

/**
 * Filesystem locations shared between the setup project and the specs.
 *
 * These live apart from `global.setup.ts` on purpose: Playwright refuses to let
 * one test file import another, so anything both sides need has to sit in a
 * plain module.
 */

const AUTH_DIRECTORY = resolve(process.cwd(), "e2e/.auth")

/** Seeded tenant handles, written once by the setup project. */
export const TENANT_STATE_PATH = resolve(AUTH_DIRECTORY, "tenant.json")

/**
 * Directory holding cached signed-in browser state.
 *
 * @returns Absolute path to the auth state directory.
 */
export function authStateDirectory(): string {
  return AUTH_DIRECTORY
}

/**
 * Path to the cached signed-in browser state for a role.
 *
 * @param role - Seeded organization role.
 * @returns Absolute path to that role's storage state file.
 */
export function authStatePath(role: OrganizationRole): string {
  return resolve(AUTH_DIRECTORY, `${role}.json`)
}
