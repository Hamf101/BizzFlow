"use client"

import type { CreateDocumentUploadUrlResponse } from "@/types/document"

/**
 * Uploads a browser File through a create-only signed object-storage URL.
 *
 * A 412 response is accepted because a retry may follow an earlier successful PUT.
 *
 * @param uploadUrl - Short-lived signed object-storage URL.
 * @param file - Browser file whose type and size were signed by the server.
 * @param failureMessage - User-safe error for storage failures.
 * @param contentType - Optional canonical MIME type when the browser omits it.
 * @returns A promise that resolves after the object is present.
 * @throws Error when storage rejects the upload for a non-idempotent reason.
 */
export async function uploadFileToSignedUrl(
  uploadUrl: string,
  file: File,
  failureMessage: string,
  contentType: string = file.type
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": contentType,
      "if-none-match": "*",
    },
    body: file,
  })

  if (!response.ok && response.status !== 412) {
    throw new Error(failureMessage)
  }
}

/**
 * Promotes an uploaded document version after server-side storage verification.
 *
 * @param uploadMetadata - Server allocation returned with the signed PUT URL.
 * @param organizationId - Tenant that owns the document and version.
 * @param failureMessage - Fallback error when the API response has no message.
 * @returns A promise that resolves after the version is available.
 * @throws Error when completion is rejected.
 */
export async function completeDocumentUploadRequest(
  uploadMetadata: CreateDocumentUploadUrlResponse,
  organizationId: string,
  failureMessage: string
): Promise<void> {
  const response = await fetch(
    `/api/documents/${uploadMetadata.documentId}/complete-upload`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId,
        versionId: uploadMetadata.versionId,
      }),
    }
  )

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, failureMessage))
  }
}

/**
 * Reads the standard user-safe error payload returned by application APIs.
 *
 * @param response - Failed API response.
 * @param fallbackMessage - Message used for malformed or empty responses.
 * @returns Server error text or the fallback.
 */
export async function readApiErrorMessage(
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
