"use client"

import { createBrowserClient } from "@supabase/ssr"

type BrowserClientInput = {
  supabaseUrl: string
  publishableKey: string
}

export function createClient({
  publishableKey,
  supabaseUrl,
}: BrowserClientInput): ReturnType<typeof createBrowserClient> {
  return createBrowserClient(supabaseUrl, publishableKey)
}
