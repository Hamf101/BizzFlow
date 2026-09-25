import { NextResponse, type NextRequest } from "next/server"

import { getSafeNextPath } from "@/lib/auth-redirects"
import { getAppUrlEnv } from "@/lib/env"
import { createClient } from "@/lib/supabase/server"

/**
 * Exchanges a Supabase Auth confirmation code and returns the user to a safe in-app path.
 *
 * @param request - Incoming Supabase Auth callback request.
 * @returns Redirect response for the accepted authentication result.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  let redirectUrl: URL

  try {
    redirectUrl = new URL(
      getSafeNextPath(requestUrl.searchParams.get("next"), "/dashboard"),
      getAppUrlEnv().NEXT_PUBLIC_APP_URL
    )
  } catch (error: unknown) {
    console.error("auth_callback_config_error", {
      reason: error instanceof Error ? error.message : "Unknown environment error",
    })
    return NextResponse.json(
      { error: "Authentication callback is not configured." },
      { status: 500 }
    )
  }

  const next = redirectUrl.pathname + redirectUrl.search
  const loginUrl = new URL("/login", redirectUrl)

  if (code) {
    try {
      const supabase = await createClient()
      const { error } = await supabase.auth.exchangeCodeForSession(code)

      if (!error) {
        return NextResponse.redirect(redirectUrl)
      }

      console.error("auth_callback_exchange_failed", {
        reason: error.message,
      })
    } catch (error: unknown) {
      console.error("auth_callback_exchange_error", {
        reason: error instanceof Error ? error.message : "Unknown environment error",
      })
    }

    // A code only comes back once the email is confirmed. Opened on another
    // device, it can't sign in there, so the person logs in to carry on.
    loginUrl.searchParams.set("confirmed", "1")
  } else {
    loginUrl.searchParams.set("error", "That link has expired or was already used. Log in, or sign up again for a new one.")
  }

  loginUrl.searchParams.set("next", next)

  return NextResponse.redirect(loginUrl)
}
