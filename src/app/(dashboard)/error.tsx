"use client"

import { TriangleAlert } from "lucide-react"
import { useEffect, type ReactElement } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { captureUnexpectedError } from "@/lib/observability"

/**
 * Dashboard segment error boundary that keeps the shell visible.
 *
 * @param props - Next.js error boundary props.
 * @returns An inline recovery panel for the failed page.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): ReactElement {
  useEffect(() => {
    captureUnexpectedError(error, {
      boundary: "dashboard",
      digest: error.digest,
    })
  }, [error])

  return (
    <div className="flex flex-col gap-4">
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>This page failed to load</AlertTitle>
        <AlertDescription>
          Something unexpected went wrong while loading this page. Try again,
          or head back to the dashboard.
        </AlertDescription>
      </Alert>
      <div>
        <Button onClick={() => reset()} size="sm" variant="outline">
          Try again
        </Button>
      </div>
    </div>
  )
}
