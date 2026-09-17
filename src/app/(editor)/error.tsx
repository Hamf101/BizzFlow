"use client"

import { TriangleAlert } from "lucide-react"
import { useEffect, type ReactElement } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { captureUnexpectedError } from "@/lib/observability"

/**
 * Editor error boundary: a short way back to work.
 *
 * @param props - Next.js error boundary props.
 * @returns A centered recovery message.
 */
export default function EditorError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): ReactElement {
  useEffect(() => {
    captureUnexpectedError(error, { boundary: "editor", digest: error.digest })
  }, [error])

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas p-6">
      <div className="grid w-full max-w-md gap-4">
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>This document failed to open</AlertTitle>
          <AlertDescription>Try again, or go back and open it once more.</AlertDescription>
        </Alert>
        <Button className="justify-self-start" onClick={() => reset()} variant="outline">
          Try again
        </Button>
      </div>
    </div>
  )
}
