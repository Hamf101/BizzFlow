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
  }

  redirectUrl.pathname = "/login"
  redirectUrl.searchParams.set("error", "Unable to confirm the authentication link.")

  return NextResponse.redirect(redirectUrl)
}
