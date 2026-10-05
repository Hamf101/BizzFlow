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
 * The keys that would let the server reach a real provider: EmailJS's (the
 * private key too, so a real one from `.env.local` never reaches the server),
 * and each AI provider's.
 */
const OUTBOUND_KEYS = [
  "EMAILJS_SERVICE_ID",
  "EMAILJS_TEMPLATE_ID",
  "EMAILJS_PUBLIC_KEY",
  "EMAILJS_PRIVATE_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
]

/**
 * Why a run's server could reach the real email or AI provider, or null.
 *
 * `next start` fills every key absent from `process.env` from `.env.local` and
 * `.env.production*`, so a missing key means the maintainer's real
 * credentials. Only a key that is present and empty keeps them out.
 *
 * It returns rather than throws so loading the Playwright config stays free of
 * side effects for tools such as knip; the config refuses to start the server.
 *
 * @param env - The environment the web server will inherit.
 * @returns The refusal naming each key that is missing or set, or null.
 */
export function findOutboundServices(env: NodeJS.ProcessEnv = process.env): string | null {
  const open = OUTBOUND_KEYS.filter((key) => env[key]?.trim() !== "")

  return open.length > 0
    ? `E2E runs must not reach real email or AI: ${open.join(", ")} must be set and empty. ` +
        "Regenerate .env.e2e with: pnpm e2e:env"
    : null
}
