import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import { getPublicSupabaseEnv } from "@/lib/env"

export async function createClient(): Promise<ReturnType<typeof createServerClient>> {
  const env = getPublicSupabaseEnv()
  const cookieStore = await cookies()

  return createServerClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: {
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // Server Components cannot write cookies; proxy refresh handles them.
          }
        },
      },
    }
  )
}
