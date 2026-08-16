"use client"

import { useEffect, type ReactElement } from "react"

type DocumentOpenTrackerProps = {
  documentId: string
  organizationId: string
}

/**
 * Records a real client-side document open without counting Next.js prefetches.
 *
 * @param props - Tenant-scoped document identifiers.
 * @returns No visible UI.
 */
export function DocumentOpenTracker({
  documentId,
  organizationId,
}: DocumentOpenTrackerProps): ReactElement | null {
  useEffect(() => {
    const controller = new AbortController()

    void fetch(`/api/documents/${encodeURIComponent(documentId)}/opened`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId }),
      signal: controller.signal,
    }).catch((error: unknown): void => {
      if (error instanceof Error && error.name !== "AbortError") {
        console.warn("document_open_tracking_failed", { documentId })
      }
    })

    return (): void => controller.abort()
  }, [documentId, organizationId])

  return null
}
