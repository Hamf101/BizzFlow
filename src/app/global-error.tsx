"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect, type ReactElement } from "react"

/**
 * Last-resort error boundary rendered when the root layout itself crashes.
 *
 * Renders outside the root layout, so it owns its own `<html>`/`<body>` and
 * cannot rely on the app stylesheet — styling is intentionally inline.
 *
 * @param props - Next.js error boundary props.
 * @returns A minimal recovery page that reports the failure.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): ReactElement {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          alignItems: "center",
          display: "flex",
          fontFamily: "system-ui, sans-serif",
          justifyContent: "center",
          margin: 0,
          minHeight: "100vh",
        }}
      >
        <main style={{ maxWidth: "24rem", padding: "1.5rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.125rem", marginBottom: "0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.875rem", marginBottom: "1.25rem", opacity: 0.7 }}>
            An unexpected error occurred. It has been reported.
          </p>
          <button
            onClick={() => reset()}
            style={{
              border: "1px solid currentColor",
              borderRadius: "0.5rem",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              font: "inherit",
              padding: "0.375rem 1rem",
            }}
            type="button"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}
