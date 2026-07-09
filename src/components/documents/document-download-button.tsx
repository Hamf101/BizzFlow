"use client"

import { Download } from "lucide-react"
import { type ReactElement, useState } from "react"

import { Button } from "@/components/ui/button"
import type { CreateDocumentDownloadUrlResponse } from "@/types/document"

type DocumentDownloadButtonProps = {
  organizationId: string
  documentId: string
  disabled?: boolean
}

/**
 * Requests a signed download URL and opens it in a new tab.
 *
 * @param props - Organization and document identifiers for the signed URL API.
 * @returns Download button with transient error state.
 */
export function DocumentDownloadButton({
  organizationId,
  documentId,
  disabled = false,
}: DocumentDownloadButtonProps): ReactElement {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)

  async function handleDownload(): Promise<void> {
    setErrorMessage(null)
    setIsLoading(true)

    try {
      const params = new URLSearchParams({ organizationId })
      const response = await fetch(
        `/api/documents/${documentId}/download-url?${params.toString()}`
      )

      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "Unable to prepare download.")
        )
      }

      const body = (await response.json()) as CreateDocumentDownloadUrlResponse
      window.open(body.downloadUrl, "_blank", "noopener,noreferrer")
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to download document."
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        disabled={disabled || isLoading}
        onClick={handleDownload}
        type="button"
        variant="outline"
      >
        <Download data-icon="inline-start" />
        {isLoading ? "Preparing" : "Download"}
      </Button>
      {errorMessage && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  )
}

async function readErrorMessage(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  try {
    const body: unknown = await response.json()

    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return body.error
    }
  } catch {
    return fallbackMessage
  }

  return fallbackMessage
}
