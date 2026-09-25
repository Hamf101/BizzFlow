"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import { enforceActionRateLimit } from "@/lib/action-rate-limit"
import { buildAuthCallbackUrl } from "@/lib/auth-redirects"
import { getClientIp } from "@/lib/client-ip"
import { getAppUrlEnv } from "@/lib/env"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import { checkRateLimit, hashRateLimitKeyPart, RateLimitError } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"
import {
  emailConfirmationRequired,
  emailSignupConfirmation,
  SignupServiceError,
} from "@/services/signup-service"

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

/**
 * Creates an account. Where the project asks people to confirm their address,
 * the link goes out through the app's own email; otherwise the account signs
 * straight in.
 *
 * @param formData - Signup email and password.
 * @returns Never returns; redirects to naming the workspace, the check-your-email page, or an error.
 */
export async function signupAction(formData: FormData): Promise<void> {
  const parsed = signupSchema.safeParse({
    email: getFormString(formData, "email"),
    password: getFormString(formData, "password"),
  })

  if (!parsed.success) {
    redirect(
      buildRedirect("/signup", {
        error: "Enter a valid email and a password with at least 8 characters.",
      })
    )
  }

  await enforceActionRateLimit({
    bucket: "auth",
    key: getClientIp(await headers()),
    redirectPath: "/signup",
    message: "Too many sign-up attempts. Try again in a few minutes.",
  })

  if (await emailConfirmationRequired()) {
    try {
      // A few an hour per address, so nobody can flood a stranger's inbox.
      await checkRateLimit("email_recipient", hashRateLimitKeyPart(parsed.data.email))
      await emailSignupConfirmation({ email: parsed.data.email, password: parsed.data.password })
    } catch (error: unknown) {
      redirect(
        buildRedirect("/signup", {
          error:
            error instanceof SignupServiceError || error instanceof RateLimitError
              ? error.message
              : "Unable to sign up. Try again.",
        })
      )
    }

    redirect("/signup?sent=1")
  }

  // Where the project skips confirmation, the account opens ready to use.
  let supabase: Awaited<ReturnType<typeof createClient>>
  let appUrl: ReturnType<typeof getAppUrlEnv>

  try {
    supabase = await createClient()
    appUrl = getAppUrlEnv()
  } catch (error: unknown) {
    console.error("signup_config_error", {
      reason: error instanceof Error ? error.message : "Unknown environment error",
    })
    redirect(buildRedirect("/signup", { error: "Sign-up isn't available right now. Try again shortly." }))
  }

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: buildAuthCallbackUrl(appUrl.NEXT_PUBLIC_APP_URL, "/welcome"),
    },
  })

  if (error) {
    console.warn("signup_rejected", {
      errorCode: error.code ?? "auth_error",
      statusCode: error.status,
    })
    redirect(
      buildRedirect("/signup", {
        error: "Unable to sign up. Check your details and try again.",
      })
    )
  }

  redirect(data.session ? "/welcome" : "/signup?sent=1")
}
