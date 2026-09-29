import { NextResponse } from "next/server"

import { createTemplateRouteErrorResponse } from "@/app/api/templates/_utils"
import { getAuthenticatedUser } from "@/lib/auth"
import { getPublicSupabaseEnv } from "@/lib/env"
import { checkRateLimit } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"
import { noticeTopic } from "@/services/documents/sharing-notice"

/**
 * What the browser needs to hear the member's own notices: the channel, and
 * their own access token, which Realtime checks against a policy that lets each
 * member hear only the channel carrying their id.
 *
 * @returns The channel, the Realtime address and the token, or a safe error.
 */
export async function GET(): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    await checkRateLimit("working_copy_read", user.id)
    const env = getPublicSupabaseEnv()
    const { data } = await (await createClient()).auth.getSession()

    return NextResponse.json(
      {
        expiresAt: data.session?.expires_at ?? null,
        key: env.SUPABASE_PUBLISHABLE_KEY,
        token: data.session?.access_token ?? null,
        topic: noticeTopic(user.id),
        url: `${env.SUPABASE_URL}/realtime/v1`,
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error: unknown) {
    return createTemplateRouteErrorResponse(error, "notices_connect", "Unable to listen for notices.")
  }
}
