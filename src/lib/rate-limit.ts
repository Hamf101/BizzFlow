import { createHash } from "node:crypto"

import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

import { getUpstashRedisEnv, isUpstashRedisEnvConfigured } from "@/lib/env"
import { captureUnexpectedError } from "@/lib/observability"

/** Abuse surfaces with independent sliding-window budgets. */
export type RateLimitBucket = "auth" | "public_signing" | "upload_initiation"

type BucketConfig = {
  limit: number
  windowSeconds: number
}

const BUCKET_CONFIGS: Readonly<Record<RateLimitBucket, BucketConfig>> = {
  auth: { limit: 10, windowSeconds: 600 },
  public_signing: { limit: 30, windowSeconds: 60 },
  upload_initiation: { limit: 30, windowSeconds: 60 },
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
 * Fails open by design: when the Upstash environment is not configured
 * (local dev, CI, tests) every check allows the request, and a Redis outage
 * logs and allows rather than locking users out of sign-in.
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

    let decision: LimiterDecision

    try {
      decision = await limiter.limit(`${bucket}:${key}`)
    } catch (error: unknown) {
      console.error("rate_limit_check_failed", {
        bucket,
        reason:
          error instanceof Error ? error.message : "Unknown rate limit error",
      })
      captureUnexpectedError(error, { bucket, source: "rate_limit" })
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

function createDefaultLimiter(bucket: RateLimitBucket): LimiterLike | null {
  if (!isUpstashRedisEnvConfigured()) {
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
