import { NextResponse } from "next/server"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { captureUnexpectedError } from "@/lib/observability"
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit"
import { createRateLimitResponse } from "@/lib/rate-limit-response"
import {
  readTrustedJsonObject,
  RequestSecurityError,
} from "@/lib/request-security"
import {
  recordDocumentRecentAccess,
  TemplateServiceError,
} from "@/services/template-service"

type DocumentOpenedRouteContext = {
  params: Promise<{ documentId: string }>
}

/**
 * Records the authenticated member's latest real open time for one document.
 *
 * @param request - JSON request containing the active organization id.
 * @param context - Dynamic document route parameters.
 * @returns Empty success response or a user-safe JSON error.
 */
export async function POST(
  request: Request,
  context: DocumentOpenedRouteContext
): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    // Keyed on the member alone: the organizationId below comes from the request
    // body and stays unverified until the service checks membership, so keying
    // on it would let a caller rotate the value to mint fresh buckets.
    await checkRateLimit("document_open", user.id)

    const { documentId } = await context.params
    const body = await readTrustedJsonObject(request)
    const organizationId = getRequiredString(body, "organizationId")

    await recordDocumentRecentAccess({
      actorUserId: user.id,
      organizationId,
      documentId,
    })
    return new Response(null, { status: 204 })
  } catch (error: unknown) {
    if (error instanceof RateLimitError) {
      return createRateLimitResponse(
        error,
        "document_route_rejected",
        "documents_opened"
      )
    }

    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }

    if (error instanceof RequestSecurityError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }

    if (error instanceof TemplateServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }

    console.error("document_open_route_failed", {
      reason: error instanceof Error ? error.message : "Unknown route error",
    })
    captureUnexpectedError(error, { routeName: "documents_opened" })
    return NextResponse.json(
      { error: "Unable to record document open." },
      { status: 500 }
    )
  }
}

function getRequiredString(
  body: Record<string, unknown>,
  key: string
): string {
  const value = body[key]

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TemplateServiceError("Organization id is required.", 400)
  }

  return value.trim()
}
