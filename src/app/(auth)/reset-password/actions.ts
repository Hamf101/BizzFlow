"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import { buildFeedbackRedirect } from "@/lib/action-result"
import { enforceActionRateLimit } from "@/lib/action-rate-limit"
import { getClientIp } from "@/lib/client-ip"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import { createClient } from "@/lib/supabase/server"

const EXPIRED = "This link has expired or was already used. Ask for a new one."

const resetSchema = z
  .object({
    confirm: z.string(),
    password: z.string().min(8, "Use at least 8 characters."),
  })
  .refine((value) => value.password === value.confirm, "The two passwords don't match.")

/**
 * Saves a new password. The emailed link's one-time token is spent here, on
 * saving, rather than when the page opens, so a mail scanner that follows the
 * link first cannot use it up. Once it is spent the person is signed in, so a
 * rejected password can be tried again without the link.
 *
 * @param formData - The new password twice, and the link's token if it came from one.
 * @returns Never returns; redirects to the dashboard or back with an error.
 */
export async function resetPasswordAction(formData: FormData): Promise<void> {
  const tokenHash = getFormString(formData, "token_hash")
  const back = (error: string): string =>
    buildRedirect("/reset-password", tokenHash ? { error, token_hash: tokenHash } : { error })
  const parsed = resetSchema.safeParse({
    confirm: getFormString(formData, "confirm"),
    password: getFormString(formData, "password"),
  })

  if (!parsed.success) {
    redirect(back(parsed.error.issues[0]?.message ?? "Check the new password."))
  }

  await enforceActionRateLimit({
    bucket: "auth",
    key: getClientIp(await headers()),
    message: "Too many attempts. Try again in a few minutes.",
    redirectPath: "/reset-password",
  })

  let supabase: Awaited<ReturnType<typeof createClient>>

  try {
    supabase = await createClient()
  } catch (error: unknown) {
    console.error("password_reset_config_error", {
      reason: error instanceof Error ? error.message : "Unknown environment error",
    })
    redirect(back("Supabase environment is not configured."))
  }

  if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" })

    if (error) {
      console.warn("password_reset_link_rejected", { code: error.code ?? null, status: error.status ?? null })
      redirect(buildRedirect("/reset-password", { error: EXPIRED }))
    }
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })

  if (error) {
    console.warn("password_reset_rejected", { code: error.code ?? null, status: error.status ?? null })
    redirect(buildRedirect("/reset-password", { error: describePasswordError(error.code) }))
  }

  redirect(buildFeedbackRedirect("/dashboard", "password_updated"))
}

function describePasswordError(code: string | undefined): string {
  switch (code) {
    case "same_password":
      return "Choose a password you haven't used here before."
    case "weak_password":
      return "Choose a longer or less common password."
    case "session_expired":
    case "session_not_found":
      return EXPIRED
    default:
      return "Unable to save that password. Try again."
  }
}
