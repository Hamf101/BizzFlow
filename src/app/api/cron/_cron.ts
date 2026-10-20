import { timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import { monitorCron } from "@/lib/observability"

/**
 * A JSON response no browser, proxy, or CDN keeps.
 *
 * @param body - Response body.
 * @param status - HTTP status.
 * @returns The uncached JSON response.
 */
export function createNoStoreResponse(
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

/**
 * Refuses a cron request unless it carries `Bearer <CRON_SECRET>`, compared in
 * constant time. A missing or short secret refuses every request.
 *
 * @param request - The scheduler's request.
 * @param job - Log prefix and the copy for an unconfigured secret.
 * @param startedAt - When the request started, for the logged duration.
 * @returns The refusal to send, or null when the request may run.
 */
export function refuseCronRequest(
  request: Request,
  job: { event: string; notConfigured: string },
  startedAt: number
): Response | null {
  const cronSecret = process.env.CRON_SECRET?.trim()

  if (!cronSecret || cronSecret.length < 16) {
    console.error(`${job.event}_misconfigured`, {
      durationMs: Date.now() - startedAt,
    })
    return createNoStoreResponse({ error: job.notConfigured }, 503)
  }

  const actual = Buffer.from(request.headers.get("authorization") ?? "")
  const expected = Buffer.from(`Bearer ${cronSecret}`)

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    console.warn(`${job.event}_rejected`, {
      durationMs: Date.now() - startedAt,
    })
    return createNoStoreResponse({ error: "Unauthorized." }, 401)
  }

  return null
}

/**
 * Runs a cron route's work inside its heartbeat: a run that answers 500 is
 * reported to the monitor as failed, and still answers with its own response.
 *
 * @param slug - The monitor's stable name.
 * @param schedule - The route's crontab in vercel.json, in UTC.
 * @param work - The route's work after its request was accepted.
 * @returns The work's response.
 */
export async function monitoredCronResponse(slug: string, schedule: string, work: () => Promise<Response>): Promise<Response> {
  let response: Response | undefined

  try {
    return await monitorCron(slug, schedule, async () => {
      response = await work()

      if (response.status >= 500) {
        throw new Error(`${slug} failed`)
      }

      return response
    })
  } catch (error: unknown) {
    if (response) {
      return response
    }

    throw error
  }
}
