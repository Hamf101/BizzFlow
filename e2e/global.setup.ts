import { mkdir, writeFile } from "node:fs/promises"

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { expect, test as setup, type Page } from "@playwright/test"

import {
  authStateDirectory,
  authStatePath,
  TENANT_STATE_PATH,
} from "./support/paths"
import {
  createAdminClient,
  ORGANIZATION_ROLES,
  seedTenant,
  type OrganizationRole,
  type SeededTenant,
} from "./support/tenant"

/**
 * One-time preparation for the whole suite.
 *
 * Two things happen here, both deliberately front-loaded so a misconfigured
 * environment fails in one obvious place rather than as six confusing spec
 * failures ten minutes later:
 *
 * 1. Object storage is checked for the exact behaviour the app depends on.
 * 2. A tenant is seeded and each role signs in once, caching browser state.
 */

setup("object storage honours create-only writes", async () => {
  const bucket = requireEnv("CLOUDFLARE_R2_BUCKET_NAME")
  const client = new S3Client({
    credentials: {
      accessKeyId: requireEnv("CLOUDFLARE_R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
    },
    endpoint: requireEnv("CLOUDFLARE_R2_ENDPOINT"),
    forcePathStyle: true,
    region: process.env.CLOUDFLARE_R2_REGION ?? "auto",
    requestChecksumCalculation: "WHEN_REQUIRED",
  })

  const key = `e2e-preflight/${Date.now()}-${Math.random().toString(36).slice(2)}`
  const put = (): Promise<unknown> =>
    client.send(
      new PutObjectCommand({
        Body: "preflight",
        Bucket: bucket,
        IfNoneMatch: "*",
        Key: key,
      })
    )

  await put()

  // Completed documents rely on create-only writes to be immutable: the second
  // write of the same key must fail. An S3 implementation that silently ignores
  // IfNoneMatch would let a finalized document be overwritten, and no spec below
  // would notice — so it is asserted directly, once, here.
  await expect(
    put(),
    "Object storage accepted a second write to the same key. The app relies on " +
      "IfNoneMatch to keep completed documents immutable, so this storage " +
      "backend is not safe to test against."
  ).rejects.toThrow()
})

setup("seed the shared tenant and sign every role in", async ({ browser }) => {
  const admin = createAdminClient()

  await mkdir(authStateDirectory(), { recursive: true })

  const tenant = await seedTenant(admin)

  await writeFile(TENANT_STATE_PATH, JSON.stringify(tenant, null, 2), "utf8")

  for (const role of ORGANIZATION_ROLES) {
    const context = await browser.newContext()
    const page = await context.newPage()

    await signIn(page, tenant, role)
    await context.storageState({ path: authStatePath(role) })
    await context.close()
  }
})

/**
 * Signs a seeded user in through the real login form.
 *
 * Going through the UI rather than forging a cookie keeps the fixture honest
 * about the session format: if the auth cookie shape changes, this breaks here
 * instead of producing six specs that are quietly unauthenticated.
 *
 * @param page - Blank page in a fresh context.
 * @param tenant - Seeded tenant.
 * @param role - Role to sign in as.
 * @returns Resolves once the dashboard has loaded.
 */
async function signIn(
  page: Page,
  tenant: SeededTenant,
  role: OrganizationRole
): Promise<void> {
  const user = tenant.users[role]

  await page.goto("/login")
  await page.getByLabel("Email").fill(user.email)
  await page.getByLabel("Password").fill(user.password)
  await page.getByRole("button", { name: /sign in/i }).click()

  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
  await expect(page.getByText(tenant.organizationName)).toBeVisible()
}

/**
 * Reads a required environment value.
 *
 * @param name - Variable name.
 * @returns The value.
 * @throws Error naming the missing variable and how to produce it.
 */
function requireEnv(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(
      `${name} is not set. Run \`pnpm e2e:env\` after \`pnpm e2e:up\`.`
    )
  }

  return value
}
