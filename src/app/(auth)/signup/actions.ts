"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import { enforceActionRateLimit } from "@/lib/action-rate-limit"
import {
  buildAcceptInvitePath,
  buildAuthCallbackUrl,
} from "@/lib/auth-redirects"
import { getClientIp } from "@/lib/client-ip"
import { getAppUrlEnv } from "@/lib/env"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import { createClient } from "@/lib/supabase/server"
import { getInvitePreview } from "@/services/organization-service"

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  inviteToken: z.string().min(1).optional(),
})

/**
 * Creates an account and preserves a pending invite through email confirmation.
 *
 * @param formData - Signup email, password, and optional invite token.
 * @returns Never returns; redirects to authentication confirmation or an error.
 */
export async function signupAction(formData: FormData): Promise<void> {
  const parsed = signupSchema.safeParse({
    email: getFormString(formData, "email"),
    password: getFormString(formData, "password"),
    inviteToken: getFormString(formData, "inviteToken") || undefined,
  })

  const signupPath = buildSignupPath(getFormString(formData, "inviteToken"))

  if (!parsed.success) {
    redirect(
      buildRedirect(signupPath, {
        error: "Enter a valid email and a password with at least 8 characters.",
      })
    )
  }

  await enforceActionRateLimit({
    bucket: "auth",
    key: getClientIp(await headers()),
    redirectPath: signupPath,
    message: "Too many sign-up attempts. Try again in a few minutes.",
  })

  let supabase: Awaited<ReturnType<typeof createClient>>
  let appUrl: ReturnType<typeof getAppUrlEnv>

  if (parsed.data.inviteToken) {
    let invitedEmail: string

    try {
      const invite = await getInvitePreview(parsed.data.inviteToken)
      invitedEmail = invite.email
    } catch (error: unknown) {
      console.warn("invite_signup_validation_failed", {
        tokenLength: parsed.data.inviteToken.length,
        errorType: error instanceof Error ? error.name : "UnknownInviteError",
      })
      redirect(buildRedirect("/signup", { error: "This invite is no longer available." }))
    }

    if (parsed.data.email.trim().toLowerCase() !== invitedEmail) {
      redirect(
        buildRedirect(signupPath, {
          error: "Create your account with the email address on the invite.",
        })
      )
    }
  }

  try {
    supabase = await createClient()
    appUrl = getAppUrlEnv()
  } catch (error: unknown) {
    console.error("signup_config_error", {
      reason: error instanceof Error ? error.message : "Unknown environment error",
    })
    redirect(
      buildRedirect(signupPath, { error: "Supabase environment is not configured." })
    )
  }

  const nextPath = parsed.data.inviteToken
    ? buildAcceptInvitePath(parsed.data.inviteToken)
    : "/dashboard"

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: buildAuthCallbackUrl(appUrl.NEXT_PUBLIC_APP_URL, nextPath),
    },
  })

  if (error) {
    console.warn("signup_rejected", {
      errorCode: error.code ?? "auth_error",
      statusCode: error.status,
    })
    redirect(
      buildRedirect(signupPath, {
        error: "Unable to create account. Check your details and try again.",
      })
    )
  }

  if (data.session) {
    redirect(nextPath)
  }

  redirect(
    buildRedirect("/login", {
      message: parsed.data.inviteToken
        ? "Confirm your account from the email we sent, then finish joining the workspace."
        : "Confirm your account, then sign in.",
      ...(parsed.data.inviteToken ? { next: nextPath } : {}),
    })
  )
}

function buildSignupPath(inviteToken: string): string {
  if (!inviteToken) {
    return "/signup"
  }

  return buildRedirect("/signup", { invite: inviteToken })
}
