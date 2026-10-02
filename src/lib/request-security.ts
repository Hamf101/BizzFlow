import { getAppUrlEnv } from "@/lib/env"

/**
 * User-safe error raised when an API request violates the JSON or origin contract.
 */
export class RequestSecurityError extends Error {
  readonly statusCode: number

  /**
   * Creates a request validation error.
   *
   * @param message - User-safe validation message.
   * @param statusCode - HTTP status returned by the route.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "RequestSecurityError"
    this.statusCode = statusCode
  }
}

/** Largest JSON body a route reads; matches the server-action body limit. */
const MAX_JSON_BODY_BYTES = 10 * 1024 * 1024

/**
 * Parses a same-origin JSON object request after enforcing content-type and origin rules.
 *
 * Requests without an Origin header remain valid for same-origin server clients and tests.
 * Browser requests declaring a cross-site Fetch Metadata context are always rejected.
 *
 * @param request - Incoming cookie-authenticated API request.
 * @returns Parsed JSON object.
 * @throws RequestSecurityError when the request is cross-origin or is not a JSON object.
 */
export async function readTrustedJsonObject(
  request: Request
): Promise<Record<string, unknown>> {
  assertTrustedRequestOrigin(request)
  assertJsonContentType(request)

  try {
    const body: unknown = JSON.parse(await readBoundedText(request))

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new RequestSecurityError("Request body must be a JSON object.", 400)
    }

    return body as Record<string, unknown>
  } catch (error: unknown) {
    if (error instanceof RequestSecurityError) {
      throw error
    }

    throw new RequestSecurityError("Request body must be valid JSON.", 400)
  }
}

// Route handlers have no body limit of their own off a platform that adds one,
// so an unbounded caller could make each request buffer as much as they send.
async function readBoundedText(request: Request): Promise<string> {
  const tooLarge = new RequestSecurityError("Request body is too large.", 413)

  if (Number(request.headers.get("content-length")) > MAX_JSON_BODY_BYTES) {
    throw tooLarge
  }

  const reader = request.body?.getReader()
  const decoder = new TextDecoder()
  let text = ""
  let bytes = 0

  while (reader) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    bytes += value.byteLength

    if (bytes > MAX_JSON_BODY_BYTES) {
      await reader.cancel()
      throw tooLarge
    }

    text += decoder.decode(value, { stream: true })
  }

  return text + decoder.decode()
}

function assertTrustedRequestOrigin(request: Request): void {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase()

  if (fetchSite === "cross-site") {
    throw new RequestSecurityError("Cross-origin requests are not allowed.", 403)
  }

  const origin = request.headers.get("origin")

  if (!origin) {
    return
  }

  let requestOrigin: string
  let applicationOrigin: string

  try {
    requestOrigin = new URL(origin).origin
    applicationOrigin = new URL(
      getAppUrlEnv().NEXT_PUBLIC_APP_URL
    ).origin
  } catch {
    throw new RequestSecurityError("Request origin could not be validated.", 403)
  }

  if (requestOrigin !== applicationOrigin) {
    throw new RequestSecurityError("Cross-origin requests are not allowed.", 403)
  }
}

function assertJsonContentType(request: Request): void {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase()

  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    throw new RequestSecurityError(
      "Content-Type must be application/json.",
      415
    )
  }
}
