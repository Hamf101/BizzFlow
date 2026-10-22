import { NextResponse } from "next/server"

import { getClientIp } from "@/lib/client-ip"
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit"
import { createRateLimitResponse } from "@/lib/rate-limit-response"
import { RequestSecurityError } from "@/lib/request-security"
import { DocumentSigningServiceError } from "@/services/document-signing-service"

/**
 * Runs one request through a private signing link: rate-limited by address,
 * and failing with a safe message that never carries the link.
 *
 * @param request - The request.
 * @param routeName - Its name in logs.
 * @param handle - What the request does.
 * @returns Its response, or a safe error.
 */
export async function handleSigningRequest(request: Request, routeName: string, handle: () => Promise<Response>): Promise<Response> {
  try {
    await checkRateLimit("public_signing", getClientIp(request.headers))
    return await handle()
  } catch (error: unknown) {
    if (error instanceof RateLimitError) {
      return createRateLimitResponse(error, "public_signing_route_rejected", routeName)
    }

    if (error instanceof DocumentSigningServiceError || error instanceof RequestSecurityError) {
      // The private token never goes into logs.
      console.warn("public_signing_route_rejected", { reason: error.message, routeName, statusCode: error.statusCode })
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }

    console.error("public_signing_route_failed", { routeName })
    return NextResponse.json({ error: "Unable to reach this document." }, { status: 500 })
  }
}

export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" }
