import type { NextRequest } from "next/server"

import { limitRequestByIp } from "@/lib/request-rate-limit"
import { updateSession } from "@/lib/supabase/proxy"

export async function proxy(request: NextRequest) {
  // First, so a flood is refused before it costs a session lookup.
  return (await limitRequestByIp(request)) ?? updateSession(request)
}

export const config = {
  matcher: [
    // "monitoring" is the Sentry tunnel route: browser events must not pay a
    // Supabase session round trip. Nor must document fonts, which are public.
    "/((?!_next/static|_next/image|favicon.ico|monitoring|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}

