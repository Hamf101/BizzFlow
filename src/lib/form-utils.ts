import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Reads a string field from FormData.
 *
 * @param formData - Submitted form data.
 * @param key - Field name to read.
 * @returns String value or an empty string when absent.
 */
export function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === "string" ? value : ""
}

/**
 * Builds a redirect path with query parameters.
 *
 * @param pathname - Redirect path, with optional existing query parameters.
 * @param params - Query parameters to append.
 * @returns Path with encoded query string.
 */
export function buildRedirect(pathname: string, params: Record<string, string>): string {
  const redirectUrl = new URL(pathname, "https://bizflow.invalid")

  for (const [key, value] of Object.entries(params)) {
    redirectUrl.searchParams.set(key, value)
  }

  // Signs the feedback text so a page shows only what this app wrote, never
  // copy an attacker put in a link (`?error=Call us at…`).
  const signature = signFlash(
    redirectUrl.searchParams.get("error"),
    redirectUrl.searchParams.get("message")
  )
  redirectUrl.searchParams.delete("sig")

  if (signature) {
    redirectUrl.searchParams.set("sig", signature)
  }

  return `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`
}

/** Feedback text read back from a redirect, or null where it was not ours. */
export type SignedFlash = { error: string | null; message: string | null }

/**
 * Reads the `?error=` and `?message=` feedback a redirect from
 * {@link buildRedirect} carried, only when its signature matches.
 *
 * @param params - The page's search params.
 * @returns The verified texts; both null for a forged or edited link.
 */
export function readSignedFlash(params: {
  error?: string
  message?: string
  sig?: string
}): SignedFlash {
  const error = params.error ?? null
  const message = params.message ?? null
  const expected = signFlash(error, message)
  const actual = params.sig ?? ""
  const verified =
    expected !== null &&
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))

  return verified ? { error, message } : { error: null, message: null }
}

function signFlash(error: string | null, message: string | null): string | null {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim()

  if ((error === null && message === null) || !secret) {
    return null
  }

  return createHmac("sha256", secret)
    .update(JSON.stringify(["bizflow-flash", error, message]))
    .digest("base64url")
    .slice(0, 32)
}
