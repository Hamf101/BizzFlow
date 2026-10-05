import * as Sentry from "@sentry/nextjs"

/**
 * Initializes runtime-specific monitoring when the server boots.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config")
    // A production deployment missing a required value fails here, at boot.
    const { assertProductionEnv } = await import("./lib/env")

    assertProductionEnv()
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config")
  }
}

export const onRequestError = Sentry.captureRequestError
