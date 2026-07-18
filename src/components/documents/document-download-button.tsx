"use client"

import { Download } from "lucide-react"
import { type ReactElement, useState } from "react"

import { Button } from "@/components/ui/button"
import { readApiErrorMessage } from "@/components/documents/document-upload-client"
import type { CreateDocumentDownloadUrlResponse } from "@/types/document"

type DocumentDownloadButtonProps = {
  organizationId: string
  documentId: string
  disabled?: boolean
  label?: string
  versionId?: string | null
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
  label = "Download",
  versionId = null,
}: DocumentDownloadButtonProps): ReactElement {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)

  async function handleDownload(): Promise<void> {
    setErrorMessage(null)
    setIsLoading(true)
    let downloadWindow: Window | null = null

    try {
      // Open synchronously while the click still has browser user activation.
      downloadWindow = window.open("about:blank", "_blank")

      if (!downloadWindow) {
        throw new Error("Allow pop-ups to download this document.")
      }

      downloadWindow.opener = null
      const response = await fetch(
        `/api/documents/${documentId}/download-url`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId, versionId }),
        }
      )

      if (!response.ok) {
        throw new Error(
          await readApiErrorMessage(response, "Unable to prepare download.")
        )
      }

      const body = (await response.json()) as CreateDocumentDownloadUrlResponse
      downloadWindow.location.replace(body.downloadUrl)
    } catch (error: unknown) {
      if (downloadWindow && !downloadWindow.closed) {
        downloadWindow.close()
      }

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
        {isLoading ? "Preparing" : label}
      </Button>
      {errorMessage && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
