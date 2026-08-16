/** Cookie name used for one path-scoped anonymous public form draft. */
export const PUBLIC_FORM_DRAFT_COOKIE_NAME = "bizflow_public_form_draft"

/** Public draft cookies expire with the upload cleanup window. */
const PUBLIC_FORM_DRAFT_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60

/**
 * Builds the security and lifetime options for a path-scoped draft cookie.
 *
 * @param token - Public form link token used in the browser path.
 * @returns HttpOnly cookie options scoped to that exact public form.
 */
export function getPublicFormDraftCookieOptions(token: string): Readonly<{
  httpOnly: true
  maxAge: number
  path: string
  sameSite: "lax"
  secure: boolean
}> {
  return {
    httpOnly: true,
    maxAge: PUBLIC_FORM_DRAFT_COOKIE_MAX_AGE_SECONDS,
    path: `/forms/${encodeURIComponent(token)}`,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  }
}
