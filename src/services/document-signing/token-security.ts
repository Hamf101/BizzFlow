import { createHash, randomBytes } from "node:crypto"

import { DocumentSigningServiceError } from "@/services/document-signing/errors"
import type { DocumentSigningRecipientRow } from "@/types/template"

/** Lifetime assigned to every newly issued private signing token. */
export const TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000

/**
 * Creates a cryptographically secure URL-safe signing token.
 *
 * @returns A new 256-bit base64url token.
 */
export function createSecureToken(): string {
  return randomBytes(32).toString("base64url")
}

/**
 * Validates and normalizes a raw signing token from a URL.
 *
 * @param value - Untrusted token value.
 * @returns Trimmed token suitable for hashing.
 * @throws DocumentSigningServiceError when the value is not a valid token.
 */
export function normalizeToken(value: string): string {
  if (typeof value !== "string") {
    throw createInvalidTokenError()
  }

  const token = value.trim()
  assertSecureToken(token)
  return token
}

/**
 * Verifies that a generated or injected token meets the private-link contract.
 *
 * @param token - Token to validate before hashing or delivery.
 * @throws DocumentSigningServiceError when the token is malformed.
 */
export function assertSecureToken(token: string): void {
  if (token.length < 32 || token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw createInvalidTokenError()
  }
}

/**
 * Hashes a private token for persistence and lookup.
 *
 * @param token - Previously validated raw token.
 * @returns Lowercase SHA-256 digest.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

/**
 * Ensures a recipient's private link has a valid future expiry.
 *
 * @param recipient - Recipient persistence row loaded by token hash.
 * @param now - Validated signing clock value.
 * @throws DocumentSigningServiceError when the link is expired or malformed.
 */
export function assertRecipientLinkUsable(
  recipient: DocumentSigningRecipientRow,
  now: Date
): void {
  const expiresAt = new Date(recipient.token_expires_at)

  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    throw new DocumentSigningServiceError(
      "This signing link has expired. Ask the sender for a new link.",
      410
    )
  }
}

/**
 * Resolves and validates the signing workflow clock.
 *
 * @param now - Optional injected clock.
 * @returns Valid current date.
 * @throws DocumentSigningServiceError when the injected clock is invalid.
 */
export function getSigningNow(now?: () => Date): Date {
  const current = (now ?? (() => new Date()))()

  if (Number.isNaN(current.getTime())) {
    throw new DocumentSigningServiceError("Signing clock is invalid.", 500)
  }

  return current
}

function createInvalidTokenError(): DocumentSigningServiceError {
  return new DocumentSigningServiceError(
    "This signing link is invalid or no longer available.",
    404
  )
}
