import { createHash } from "node:crypto"

import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

import { getUpstashRedisEnv, isUpstashRedisEnvConfigured } from "@/lib/env"
import { captureUnexpectedError } from "@/lib/observability"

/** Abuse surfaces with independent sliding-window budgets. */
export type RateLimitBucket =
  | "auth"
  | "public_signing"
  | "upload_initiation"
  | "ai_flow"
  | "ai_flow_daily"
  | "outbound_email"
  | "outbound_email_daily"
  | "email_recipient"
  | "pdf_render"
  | "document_open"

/**
 * How a bucket behaves when a configured limiter cannot be reached.
 *
 * `open` allows the request: an Upstash outage must never lock members out of
 * sign-in or signing. `closed` denies it, which is correct only where a request
 * spends money with a third party (AI tokens, Resend sends) and losing the
 * ceiling is worse than losing the feature.
 */
type BucketFailMode = "open" | "closed"

type BucketConfig = {
  limit: number
  windowSeconds: number
  failMode: BucketFailMode
}

/** Retry hint used when a fail-closed bucket denies on limiter unavailability. */
const LIMITER_UNAVAILABLE_RETRY_SECONDS = 30

const BUCKET_CONFIGS: Readonly<Record<RateLimitBucket, BucketConfig>> = {
  auth: { limit: 10, windowSeconds: 600, failMode: "open" },
  public_signing: { limit: 30, windowSeconds: 60, failMode: "open" },
  upload_initiation: { limit: 30, windowSeconds: 60, failMode: "open" },
  // Burst control per member; the daily bucket is the actual org spend ceiling.
  ai_flow: { limit: 20, windowSeconds: 60, failMode: "closed" },
  ai_flow_daily: { limit: 400, windowSeconds: 86_400, failMode: "closed" },
  // Keyed per authenticated member, never on a form-supplied organization id:
  // that value is unverified at the point an action can enforce a budget.
  outbound_email: { limit: 10, windowSeconds: 3_600, failMode: "closed" },
  outbound_email_daily: {
    limit: 100,
    windowSeconds: 86_400,
    failMode: "closed",
  },
  // Guards one recipient's inbox against a resend loop aimed at a third party.
  email_recipient: { limit: 3, windowSeconds: 3_600, failMode: "closed" },
  pdf_render: { limit: 30, windowSeconds: 60, failMode: "open" },
  document_open: { limit: 120, windowSeconds: 60, failMode: "open" },
}

/** The subset of an Upstash ratelimit decision the check depends on. */
export type LimiterDecision = {
  success: boolean
  reset: number
}

/** Minimal limiter contract so tests never construct real Upstash clients. */
export type LimiterLike = {
  limit: (key: string) => Promise<LimiterDecision>
}

export type RateLimitDeps = {
  createLimiter?: (bucket: RateLimitBucket) => LimiterLike | null
  now?: () => number
}

/** Function that resolves when a request is within its bucket's budget. */
export type CheckRateLimit = (
  bucket: RateLimitBucket,
  key: string
) => Promise<void>

/**
 * User-safe error raised when a caller exceeds a rate-limit bucket.
 */
export class RateLimitError extends Error {
  readonly statusCode = 429
  readonly retryAfterSeconds: number

  /**
   * Creates a rate-limit rejection.
   *
   * @param retryAfterSeconds - Whole seconds until the bucket window resets.
   */
  constructor(retryAfterSeconds: number) {
    super("Too many requests. Try again shortly.")
    this.name = "RateLimitError"
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/**
 * Creates a distributed rate-limit check backed by Upstash Redis.
 *
 * Two distinct "no limiter" states behave differently on purpose:
 *
 * - **Unconfigured** (local dev, CI, tests): every bucket allows, including
 *   fail-closed ones. Route tests depend on this, and a missing env var on the
 *   host should degrade protection rather than kill the feature outright.
 * - **Configured but unreachable** (Redis outage): fail-open buckets log and
 *   allow; fail-closed buckets deny, so a third-party spend ceiling is never
 *   silently removed.
 *
 * @param deps - Optional limiter factory and clock for deterministic tests.
 * @returns An async check that throws {@link RateLimitError} when denied.
 */
export function createRateLimitCheck(deps: RateLimitDeps = {}): CheckRateLimit {
  const createLimiter = deps.createLimiter ?? createDefaultLimiter
  const now = deps.now ?? Date.now
  const limiters = new Map<RateLimitBucket, LimiterLike | null>()

  return async (bucket: RateLimitBucket, key: string): Promise<void> => {
    if (!limiters.has(bucket)) {
      limiters.set(bucket, createLimiter(bucket))
    }

    const limiter = limiters.get(bucket) ?? null

    if (!limiter) {
      return
    }

    const config = BUCKET_CONFIGS[bucket]
    let decision: LimiterDecision

    try {
      decision = await limiter.limit(`${bucket}:${key}`)
    } catch (error: unknown) {
      console.error("rate_limit_check_failed", {
        bucket,
        failMode: config.failMode,
        reason:
          error instanceof Error ? error.message : "Unknown rate limit error",
      })
      captureUnexpectedError(error, { bucket, source: "rate_limit" })

      if (config.failMode === "closed") {
        // Reuses the generic over-limit message so an outage never tells a
        // caller which part of the infrastructure is unavailable.
        throw new RateLimitError(LIMITER_UNAVAILABLE_RETRY_SECONDS)
      }

      return
    }

    if (!decision.success) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((decision.reset - now()) / 1000)
      )
      throw new RateLimitError(retryAfterSeconds)
    }
  }
}

/**
 * Hashes a personal key component (such as an email address) so PII never
 * appears in Redis keys, matching the repo's token-hashing discipline.
 *
 * @param value - Raw key component.
 * @returns Hex SHA-256 digest of the normalized value.
 */
export function hashRateLimitKeyPart(value: string): string {
  return createHash("sha256")
    .update(value.trim().toLowerCase(), "utf8")
    .digest("hex")
}

let hasWarnedUnconfigured = false

function warnWhenUnconfiguredInProduction(): void {
  if (hasWarnedUnconfigured || process.env.NODE_ENV !== "production") {
    return
  }

  hasWarnedUnconfigured = true
  console.warn("rate_limit_unconfigured", {
    reason:
      "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are unset; every bucket allows all requests.",
  })
}

function createDefaultLimiter(bucket: RateLimitBucket): LimiterLike | null {
  if (!isUpstashRedisEnvConfigured()) {
    warnWhenUnconfiguredInProduction()
    return null
  }

  const environment = getUpstashRedisEnv()
  const config = BUCKET_CONFIGS[bucket]

  return new Ratelimit({
    redis: new Redis({
      url: environment.UPSTASH_REDIS_REST_URL,
      token: environment.UPSTASH_REDIS_REST_TOKEN,
    }),
    limiter: Ratelimit.slidingWindow(
      config.limit,
      `${config.windowSeconds} s`
    ),
    prefix: "bizflow:rate-limit",
    ephemeralCache: new Map(),
  })
}

/** Shared process-wide rate-limit check used by actions and routes. */
export const checkRateLimit: CheckRateLimit = createRateLimitCheck()
