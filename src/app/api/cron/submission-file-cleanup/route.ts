import { timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import { cleanupExpiredSubmissionFileObjects } from "@/services/submission-service"

/**
 * Removes expired R2 objects that may have arrived after an upload was cancelled.
 *
 * @param request - Vercel Cron request authenticated with `CRON_SECRET`.
 * @returns Bounded cleanup counts without exposing object keys.
 */
export async function GET(request: Request): Promise<Response> {
  const startedAt = Date.now()
  const cronSecret = process.env.CRON_SECRET?.trim()

  if (!cronSecret || cronSecret.length < 16) {
    console.error("submission_file_cleanup_cron_misconfigured", {
      durationMs: Date.now() - startedAt,
    })
    return createNoStoreResponse(
      { error: "Submission cleanup is not configured." },
      503
    )
  }

  if (!hasValidCronAuthorization(request, cronSecret)) {
    console.warn("submission_file_cleanup_cron_rejected", {
      durationMs: Date.now() - startedAt,
    })
    return createNoStoreResponse({ error: "Unauthorized." }, 401)
  }

  try {
    const result = await cleanupExpiredSubmissionFileObjects()
    return createNoStoreResponse(result, 200)
  } catch (error: unknown) {
    console.error("submission_file_cleanup_cron_failed", {
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.name : "Unknown cleanup error",
    })
    return createNoStoreResponse(
      { error: "Submission file cleanup failed." },
      500
    )
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
