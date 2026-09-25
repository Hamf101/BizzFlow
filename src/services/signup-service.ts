import { getAppUrlEnv, getEmailEnv, getPublicSupabaseEnv } from "@/lib/env"
import { type AdminSupabaseClient, createAdminClient } from "@/lib/supabase/admin"
import type { EmailTransport } from "@/services/email/contracts"
import { createActionEmailHtml, wrapEmailDocument } from "@/services/email/html"
import { sendEmail } from "@/services/email/transport"

/** Error raised when a sign-up can't go ahead, with copy fit to show. */
export class SignupServiceError extends Error {
  readonly statusCode: number

  /**
   * @param message - User-safe explanation.
   * @param statusCode - HTTP-style status for the caller to translate.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "SignupServiceError"
    this.statusCode = statusCode
  }
}

export type SignupDeps = {
  client?: Pick<AdminSupabaseClient, "auth">
  fetch?: typeof fetch
  transport?: EmailTransport
}

/**
 * Whether the project asks new accounts to confirm their address, as set by
 * Supabase's "Confirm email" switch. When it can't tell, it asks.
 *
 * @param deps - Optional fetch for tests.
 * @returns True when a new account must confirm its address first.
 */
export async function emailConfirmationRequired(deps: Pick<SignupDeps, "fetch"> = {}): Promise<boolean> {
  try {
    const env = getPublicSupabaseEnv()
    const response = await (deps.fetch ?? fetch)(new URL("/auth/v1/settings", env.SUPABASE_URL), {
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY },
    })
    const settings = (await response.json()) as { mailer_autoconfirm?: unknown }

    return settings.mailer_autoconfirm !== true
  } catch {
    return true
  }
}

/**
 * Opens an account that waits for its owner to confirm the address, and emails
 * them the link through the app's own email, like every other email it sends:
 * Supabase makes the one-time token and sends nothing. Signing up again sends a
 * fresh link. An address that already has an account gets nothing, and the
 * caller says the same either way, so the form never reveals who has signed up.
 *
 * @param input - The address and password chosen.
 * @param deps - Optional admin client and email transport for tests.
 * @throws SignupServiceError 400 for a password Supabase refuses, 502 when the email can't be sent.
 */
export async function emailSignupConfirmation(
  input: { email: string; password: string },
  deps: SignupDeps = {}
): Promise<void> {
  const startedAt = performance.now()
  const client = deps.client ?? createAdminClient()
  const { data, error } = await client.auth.admin.generateLink({
    email: input.email,
    password: input.password,
    type: "signup",
  })

  if (error?.code === "email_exists" || error?.code === "user_already_exists") {
    console.info("signup_confirmation_not_sent", { reason: "existing_account" })
    return
  }

  if (error?.code === "weak_password") {
    throw new SignupServiceError("Choose a longer or less common password.", 400)
  }

  if (error || !data.properties) {
    console.error("signup_confirmation_link_failed", { code: error?.code ?? null, status: error?.status ?? null })
    throw new SignupServiceError("Unable to sign up. Try again.", 500)
  }

  const link = new URL("/confirm-email", getAppUrlEnv().NEXT_PUBLIC_APP_URL)
  link.searchParams.set("token_hash", data.properties.hashed_token)
  link.searchParams.set("type", data.properties.verification_type)
  const url = link.toString()
  const subject = "Confirm your email for BizFlow Docs"

  try {
    const emailEnv = getEmailEnv()
    const result = await (deps.transport ?? sendEmail)(
      {
        deliveryReference: `signup-confirmation/${data.user.id}`,
        payload: {
          html: wrapEmailDocument({
            contentHtml: createActionEmailHtml({
              action: "Confirm my email",
              body: "Confirm this address to finish signing up for BizFlow Docs. The link works once.",
              heading: "Confirm your email",
              note: "If you didn't sign up, ignore this email and no account will be opened.",
              url,
            }),
            subject,
          }),
          subject,
          text: `Confirm this address to finish signing up for BizFlow Docs: ${url} If you didn't sign up, ignore this email.`,
          toEmail: input.email,
          ...(emailEnv.EMAIL_REPLY_TO_EMAIL ? { replyTo: emailEnv.EMAIL_REPLY_TO_EMAIL } : {}),
        },
      },
      emailEnv
    )

    console.info("signup_confirmation_email_delivered", {
      durationMs: Math.round(performance.now() - startedAt),
      providerStatus: result.providerStatus,
      userId: data.user.id,
    })
  } catch (sendError: unknown) {
    console.error("signup_confirmation_email_failed", {
      durationMs: Math.round(performance.now() - startedAt),
      reason: sendError instanceof Error ? sendError.message : "Unknown email error",
    })
    throw new SignupServiceError("We couldn't send the confirmation email. Try again.", 502)
  }
}
