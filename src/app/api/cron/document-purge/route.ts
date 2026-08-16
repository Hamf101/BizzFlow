import { timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import { captureUnexpectedError } from "@/lib/observability"
import { processDueResourcePurges } from "@/services/document-service"

/**
 * Processes a bounded batch of due document and folder purge work.
 *
 * @param request - Vercel Cron request authenticated with `CRON_SECRET`.
 * @returns Content-free queue, object, retry, and finalization counts.
 */
export async function GET(request: Request): Promise<Response> {
  const startedAt = Date.now()
  const cronSecret = process.env.CRON_SECRET?.trim()

  if (!cronSecret || cronSecret.length < 16) {
    console.error("document_purge_cron_misconfigured", {
      durationMs: Date.now() - startedAt,
    })
    return createNoStoreResponse(
      { error: "Document purge is not configured." },
      503
    )
  }

  if (!hasValidCronAuthorization(request, cronSecret)) {
    console.warn("document_purge_cron_rejected", {
      durationMs: Date.now() - startedAt,
    })
    return createNoStoreResponse({ error: "Unauthorized." }, 401)
  }

  try {
    const result = await processDueResourcePurges()
    return createNoStoreResponse(result, 200)
  } catch (error: unknown) {
    console.error("document_purge_cron_failed", {
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.name : "Unknown purge error",
    })
    captureUnexpectedError(error, { routeName: "cron_document_purge" })
    return createNoStoreResponse({ error: "Document purge failed." }, 500)
  }
}

function hasValidCronAuthorization(
  request: Request,
  cronSecret: string
): boolean {
  const actual = Buffer.from(request.headers.get("authorization") ?? "")
  const expected = Buffer.from(`Bearer ${cronSecret}`)

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function createNoStoreResponse(
  body: Record<string, unknown>,
  status: number
): Response {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
    },
  })
}
