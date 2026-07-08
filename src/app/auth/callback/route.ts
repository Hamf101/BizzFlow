import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const redirectUrl = new URL(request.url)
  redirectUrl.pathname = "/dashboard"
  redirectUrl.search = ""

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
      console.error("auth_callback_config_error", {
        reason: error instanceof Error ? error.message : "Unknown environment error",
      })
    }
  }

  redirectUrl.pathname = "/login"
  redirectUrl.searchParams.set("error", "Unable to confirm the authentication link.")

  return NextResponse.redirect(redirectUrl)
}
