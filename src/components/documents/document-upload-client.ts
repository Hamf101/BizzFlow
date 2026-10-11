"use client"

import type { CreateDocumentUploadUrlResponse } from "@/types/document"

/** The kinds of file a document or an answer's upload takes, for a file input's `accept`. */
export const UPLOAD_ACCEPT = ".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv"

/**
 * Adds a file to Files: prepares the document and its upload, puts the bytes
 * in storage, and has the server verify them before the version is available.
 *
 * @param input - The file, its canonical type, where it goes, its title, and a signal that stops it.
 * @returns The new document's upload allocation.
 * @throws Error with a user-safe message when any step is refused.
 */
export async function uploadDocumentFile(input: {
  contentType?: string
  file: File
  folderId: string | null
  organizationId: string
  signal?: AbortSignal
  title: string
}): Promise<CreateDocumentUploadUrlResponse> {
  const { file, folderId, organizationId, signal, title } = input
  const contentType = input.contentType ?? file.type
  const response = await fetch("/api/documents/upload-url", {
    body: JSON.stringify({
      byteSize: file.size,
      contentType,
      description: null,
      folderId,
      organizationId,
      originalFilename: file.name,
      title,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal,
  })

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, "Unable to prepare upload."))
  }

  const uploadMetadata = (await response.json()) as CreateDocumentUploadUrlResponse

  await uploadFileToSignedUrl(uploadMetadata.uploadUrl, file, "Unable to upload file to storage.", contentType, signal)
  await completeDocumentUploadRequest(uploadMetadata, organizationId, "Unable to complete upload.", signal)

  return uploadMetadata
}

/**
 * Uploads a browser File through a create-only signed object-storage URL.
 *
 * A 412 response is accepted because a retry may follow an earlier successful PUT.
 *
 * @param uploadUrl - Short-lived signed object-storage URL.
 * @param file - Browser file or blob whose type and size were signed by the server.
 * @param failureMessage - User-safe error for storage failures.
 * @param contentType - Optional canonical MIME type when the browser omits it.
 * @param signal - Stops the upload.
 * @returns A promise that resolves after the object is present.
 * @throws Error when storage rejects the upload for a non-idempotent reason.
 */
export async function uploadFileToSignedUrl(
  uploadUrl: string,
  file: Blob,
  failureMessage: string,
  contentType: string = file.type,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(uploadUrl, {
    signal,
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
 * @param signal - Stops the request.
 * @returns A promise that resolves after the version is available.
 * @throws Error when completion is rejected.
 */
export async function completeDocumentUploadRequest(
  uploadMetadata: CreateDocumentUploadUrlResponse,
  organizationId: string,
  failureMessage: string,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(
    `/api/documents/${uploadMetadata.documentId}/complete-upload`,
    {
      signal,
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

/**
 * Opens a tab while the click still counts as the person's, then sends it to
 * the file's signed address once that arrives, closing it again on a failure.
 *
 * @param blockedMessage - What to say when the browser blocks the tab.
 * @param readUrl - Fetches the signed address.
 * @returns A promise that resolves once the tab is on its way.
 * @throws Error when the tab is blocked or the address cannot be had.
 */
export async function openDownloadTab(blockedMessage: string, readUrl: () => Promise<string>): Promise<void> {
  // Open synchronously while the click still has browser user activation.
  const downloadWindow = window.open("about:blank", "_blank")

  if (!downloadWindow) {
    throw new Error(blockedMessage)
  }

  downloadWindow.opener = null

  try {
    downloadWindow.location.replace(await readUrl())
  } catch (error: unknown) {
    if (!downloadWindow.closed) {
      downloadWindow.close()
    }

    throw error
  }
}
