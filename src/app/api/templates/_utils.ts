import { createRouteErrorResponse } from "@/app/api/_route-error"
import { getAuthenticatedUser } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import {
  getCurrentOrganizationContext,
  OrganizationServiceError,
} from "@/services/organization-service"
import type { FlowStage } from "@/services/template-flow/contracts"
import { TemplateFlowServiceError } from "@/services/template-flow-service"
import { WorkingCopyServiceError } from "@/services/working-copy-service"

/**
 * Signs the member in and spends one Flow turn from both of their buckets,
 * the same for every surface Flow answers on. A rebuild makes no AI call, so
 * it spends from its own per-member bucket instead of the AI budget.
 *
 * @param kind - "turn" for a Flow request, "rebuild" for re-applying kept changes.
 * @returns The member and the organization the turn belongs to.
 * @throws TemplateFlowServiceError without an organization; RateLimitError past a limit.
 */
export async function startFlowTurn(kind: "turn" | "rebuild" = "turn"): Promise<{ organizationId: string; userId: string }> {
  const user = await getAuthenticatedUser()
  const context = await getCurrentOrganizationContext(user.id)

  if (!context) {
    throw new TemplateFlowServiceError(
      "Create or join an organization before using Flow.",
      403
    )
  }

  // Gated before the body is parsed so an abusive caller never gets the parse
  // done on their behalf. Both buckets fail closed: an Upstash outage must not
  // silently remove the only ceiling on metered AI-provider spend.
  if (kind === "rebuild") {
    await checkRateLimit("ai_flow_rebuild", `${context.organization.id}:${user.id}`)
  } else {
    await checkRateLimit("ai_flow", `${context.organization.id}:${user.id}`)
    await checkRateLimit("ai_flow_daily", context.organization.id)
  }

  return { organizationId: context.organization.id, userId: user.id }
}

/**
 * Converts typed template route failures into user-safe JSON responses.
 *
 * @param error - Unknown caught route failure.
 * @param routeName - Stable route identifier included in logs.
 * @returns JSON error response with an appropriate HTTP status.
 */
export function createTemplateRouteErrorResponse(
  error: unknown,
  routeName: string,
  failure = "Unable to complete the Flow request."
): Response {
  return createRouteErrorResponse(error, routeName, {
    event: "template_route",
    failure,
    known: [
      TemplateFlowServiceError,
      OrganizationServiceError,
      WorkingCopyServiceError,
    ],
  })
}

/** What a Flow client asks for to hear each stage as it starts: one JSON object a line. */
export const FLOW_STREAM_TYPE = "application/x-ndjson"

/**
 * Runs one Flow turn. A client that reads a stream hears each stage as it
 * starts, then the answer, or an error with the message and status a plain
 * response would carry; any other client gets the answer in one piece. What
 * fails before the turn starts, such as sign-in or a rate limit, is answered
 * by the route as usual, before any stream begins.
 *
 * @param request - The route's request, to read what it accepts.
 * @param routeName - Stable route identifier for logs.
 * @param run - The turn, told where to report each stage.
 * @returns The streamed or whole response.
 */
export async function streamFlowTurn(
  request: Request,
  routeName: string,
  run: (onStage: (stage: FlowStage) => void) => Promise<unknown>
): Promise<Response> {
  if (!request.headers.get("accept")?.includes(FLOW_STREAM_TYPE)) {
    try {
      return Response.json(await run(() => undefined))
    } catch (error: unknown) {
      return createTemplateRouteErrorResponse(error, routeName)
    }
  }

  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: object): void => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`))

      try {
        send({ result: await run((stage) => send({ stage })) })
      } catch (error: unknown) {
        const failed = createTemplateRouteErrorResponse(error, routeName)
        const { error: message } = (await failed.json()) as { error: string }
        send({ error: message, status: failed.status })
      } finally {
        controller.close()
      }
    },
  })

  // No buffering on the way, so each stage reaches the member as it happens.
  return new Response(body, { headers: { "Cache-Control": "no-store", "Content-Type": `${FLOW_STREAM_TYPE}; charset=utf-8`, "X-Accel-Buffering": "no" } })
}
