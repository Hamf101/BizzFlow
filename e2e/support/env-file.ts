import { existsSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Path to the generated E2E environment file.
 *
 * `scripts/write-e2e-env.mjs` writes it from `supabase status`, so it holds
 * whatever keys the local stack actually minted rather than values copied into
 * a checked-in file that silently rots.
 */
export const E2E_ENV_FILE = resolve(process.cwd(), ".env.e2e")

/**
 * Loads `.env.e2e` into `process.env` when it exists.
 *
 * Values already present in the environment win, so CI can override any single
 * setting without regenerating the file. Uses Node's own loader rather than a
 * `dotenv` dependency — this repo targets Node >= 22, where it is built in.
 *
 * @returns True when a file was found and loaded.
 */
export function loadE2eEnvFile(): boolean {
  if (!existsSync(E2E_ENV_FILE)) {
    return false
  }

  process.loadEnvFile(E2E_ENV_FILE)

  return true
}

/**
 * The EmailJS keys `getEmailEnv` reads. The first three must all be set before
 * it hands out credentials; the private key is checked too so a real one from
 * `.env.local` never reaches the e2e server at all.
 */
const EMAIL_KEYS = [
  "EMAILJS_SERVICE_ID",
  "EMAILJS_TEMPLATE_ID",
  "EMAILJS_PUBLIC_KEY",
  "EMAILJS_PRIVATE_KEY",
]

/**
 * Refuses a run whose server could reach the real email provider.
 *
 * `next start` fills every key absent from `process.env` from `.env.local` and
 * `.env.production*`, so a missing key means the maintainer's real EmailJS
 * credentials. Only a key that is present and empty keeps them out.
 *
 * @param env - The environment the web server will inherit.
 * @throws Error naming each email key that is missing or set.
 */
export function assertNoOutboundEmail(env: NodeJS.ProcessEnv = process.env): void {
  const open = EMAIL_KEYS.filter((key) => env[key]?.trim() !== "")

  if (open.length > 0) {
    throw new Error(
      `E2E runs must not send real email: ${open.join(", ")} must be set and empty. ` +
        "Regenerate .env.e2e with `pnpm e2e:env`."
    )
  }
}
