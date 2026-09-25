import { getAppUrlEnv, getEmailEnv } from "@/lib/env"
import { type AdminSupabaseClient, createAdminClient } from "@/lib/supabase/admin"
import { type EmailTransport, EmailTransportError } from "@/services/email/contracts"
import { createActionEmailHtml, wrapEmailDocument } from "@/services/email/html"
import { sendEmail } from "@/services/email/transport"

export type PasswordResetDeps = {
  client?: Pick<AdminSupabaseClient, "auth">
  transport?: EmailTransport
}

/**
 * Emails whoever owns an address a link for choosing a new password. Supabase
 * makes the one-time token without sending anything itself, and the link opens
 * a page that spends it only when the new password is saved, so a mail scanner
 * that follows links first cannot use it up. It finishes the same way whether
 * or not the address has an account, and never throws, so the form never
 * reveals who has signed up.
 *
 * @param input - The address someone asked for a link for.
 * @param deps - Optional admin client and email transport for tests.
 */
export async function sendPasswordResetEmail(
  input: { email: string },
  deps: PasswordResetDeps = {}
): Promise<void> {
  const startedAt = performance.now()

  try {
    const client = deps.client ?? createAdminClient()
    const { data, error } = await client.auth.admin.generateLink({ type: "recovery", email: input.email })

    if (error) {
      // Usually there is no such account; the visitor is told the same either way.
      console.info("password_reset_not_sent", { code: error.code ?? null, status: error.status ?? null })
      return
    }

    const link = new URL("/reset-password", getAppUrlEnv().NEXT_PUBLIC_APP_URL)
    link.searchParams.set("token_hash", data.properties.hashed_token)
    const url = link.toString()
    const subject = "Choose a new password for BizFlow Docs"
    const emailEnv = getEmailEnv()
    const result = await (deps.transport ?? sendEmail)(
      {
        deliveryReference: `password-reset/${data.user.id}`,
        payload: {
          html: wrapEmailDocument({
            contentHtml: createActionEmailHtml({
              action: "Choose a new password",
              body: "Someone asked to reset the password for this address. If it was you, choose a new one below. The link works once.",
              heading: "Choose a new password",
              note: "If you did not ask for this, ignore this email. Your password stays the same.",
              url,
            }),
            subject,
          }),
          subject,
          text: `Someone asked to reset your BizFlow Docs password. If it was you, choose a new one here: ${url} If it wasn't, ignore this email; your password stays the same.`,
          toEmail: input.email,
          ...(emailEnv.EMAIL_REPLY_TO_EMAIL ? { replyTo: emailEnv.EMAIL_REPLY_TO_EMAIL } : {}),
        },
      },
      emailEnv
    )

    console.info("password_reset_email_delivered", {
      durationMs: Math.round(performance.now() - startedAt),
      providerStatus: result.providerStatus,
      userId: data.user.id,
    })
  } catch (error: unknown) {
    console.error("password_reset_email_failed", {
      durationMs: Math.round(performance.now() - startedAt),
      failureKind: error instanceof EmailTransportError ? error.kind : "unexpected_error",
      providerStatus: error instanceof EmailTransportError ? error.providerStatus : null,
    })
  }
}
