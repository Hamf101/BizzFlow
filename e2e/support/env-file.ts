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
