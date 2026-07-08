import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import { getPublicSupabaseEnv, isPublicSupabaseEnvConfigured } from "@/lib/env"

const PROTECTED_PREFIXES: readonly string[] = ["/dashboard", "/people", "/audit-log"]

/**
 * Checks whether a request path requires an authenticated session.
 *
 * @param pathname - Request pathname from Next.js middleware.
 * @returns True when the path belongs to a protected app area.
 */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix: string) => pathname.startsWith(prefix))
}

/**
 * Refreshes Supabase auth cookies and redirects unauthenticated protected routes.
 *
 * @param request - Incoming Next.js middleware request.
 * @returns Response with refreshed cookies or an auth redirect.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request })

  if (!isPublicSupabaseEnvConfigured()) {
    if (isProtectedPath(request.nextUrl.pathname)) {
      const redirectUrl = request.nextUrl.clone()
      redirectUrl.pathname = "/login"
      redirectUrl.searchParams.set("error", "Supabase environment is not configured.")

      return NextResponse.redirect(redirectUrl)
    }

    return response
  }

  const env = getPublicSupabaseEnv()

  const supabase = createServerClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })

          response = NextResponse.next({ request })

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })

          Object.entries(headers).forEach(([key, value]: [string, string]) => {
            response.headers.set(key, value)
          })
        },
      },
    }
  )

  const { data } = await supabase.auth.getClaims()
  const isAuthenticated = Boolean(data?.claims)

  if (!isAuthenticated && isProtectedPath(request.nextUrl.pathname)) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = "/login"
    redirectUrl.searchParams.set("next", request.nextUrl.pathname)

    return NextResponse.redirect(redirectUrl)
  }

  return response
}
