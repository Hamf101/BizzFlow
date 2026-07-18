"use client"

import { readApiErrorMessage } from "@/components/documents/document-upload-client"
import type { SubmissionFile } from "@/types/submission"

/** Response returned after allocating one submission file upload. */
export type SubmissionFileUploadAllocation = {
  expiresInSeconds: number
  file: SubmissionFile
  uploadUrl: string
}

/** Response returned after signing one private submission file download. */
export type SubmissionFileDownload = {
  downloadUrl: string
  expiresInSeconds: number
}

/** Metadata required to allocate a create-only submission file object. */
export type RequestSubmissionFileUploadInput = {
  byteSize: number
  contentType: string
  checksumSha256: string
  expectedRevision: number
  fieldKey: string
  organizationId: string
  originalFilename: string
  submissionId: string
}

/** Identifiers required to complete or download a submission file. */
export type SubmissionFileRequestIdentity = {
  fileId: string
  organizationId: string
  submissionId: string
}

/**
 * Requests an allocated database row and short-lived signed PUT URL.
 *
 * @param input - Tenant, draft revision, field, and browser file metadata.
 * @returns Upload allocation containing the pending file and signed URL.
 * @throws Error when the application API rejects the allocation.
 */
export async function requestSubmissionFileUpload(
  input: RequestSubmissionFileUploadInput
): Promise<SubmissionFileUploadAllocation> {
  const response = await fetch(
    `/api/submissions/${encodeURIComponent(input.submissionId)}/files/upload-url`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: input.organizationId,
        expectedRevision: input.expectedRevision,
        fieldKey: input.fieldKey,
        originalFilename: input.originalFilename,
        contentType: input.contentType,
        byteSize: input.byteSize,
        checksumSha256: input.checksumSha256,
      }),
    }
  )

  if (!response.ok) {
    throw new Error(
      await readApiErrorMessage(response, "Unable to prepare file upload.")
    )
  }

  return (await response.json()) as SubmissionFileUploadAllocation
}

/**
 * Computes the lowercase SHA-256 digest bound to one upload allocation.
 *
 * @param file - Browser file bounded by the submission upload limit.
 * @returns Lowercase hexadecimal SHA-256 digest.
 * @throws Error when browser cryptography is unavailable.
 */
export async function calculateSubmissionFileChecksum(
  file: Blob
): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Secure file verification is not available in this browser.")
  }

  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer()
  )

  return Array.from(new Uint8Array(digest), (byte: number): string =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

/**
 * Resolves the canonical upload MIME type from a supported filename extension.
 *
 * @param file - Browser-selected file.
 * @returns MIME type used consistently for signing and the R2 PUT.
 * @throws Error when the filename extension is unsupported.
 */
export function resolveSubmissionFileContentType(file: File): string {
  const filename = file.name.toLowerCase()
  const contentTypesByExtension: Readonly<Record<string, string>> = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
  }
  const matchingEntry = Object.entries(contentTypesByExtension).find(
    ([extension]: [string, string]): boolean => filename.endsWith(extension)
  )

  if (!matchingEntry) {
    throw new Error("Choose a PDF, PNG, JPG, DOCX, XLSX, or CSV file.")
  }

  return matchingEntry[1]
}

/**
 * Completes a pending file after the server verifies the private R2 object.
 *
 * @param input - Tenant, submission, and allocated file identifiers.
 * @returns Available file metadata returned by the completion API.
 * @throws Error when verification or promotion fails.
 */
export async function completeSubmissionFileUpload(
  input: SubmissionFileRequestIdentity
): Promise<SubmissionFile> {
  const response = await fetch(
    `/api/submissions/${encodeURIComponent(input.submissionId)}/files/${encodeURIComponent(input.fileId)}/complete`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: input.organizationId }),
    }
  )

  if (!response.ok) {
    throw new Error(
      await readApiErrorMessage(response, "Unable to complete file upload.")
    )
  }

  const body = (await response.json()) as { file: SubmissionFile }
  return body.file
}

/**
 * Requests a short-lived private download URL for an available submission file.
 *
 * @param input - Tenant, submission, and available file identifiers.
 * @returns Signed download URL metadata.
 * @throws Error when access is denied or signing fails.
 */
export async function requestSubmissionFileDownload(
  input: SubmissionFileRequestIdentity
): Promise<SubmissionFileDownload> {
  const response = await fetch(
    `/api/submissions/${encodeURIComponent(input.submissionId)}/files/${encodeURIComponent(input.fileId)}/download-url`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: input.organizationId }),
    }
  )

  if (!response.ok) {
    throw new Error(
      await readApiErrorMessage(response, "Unable to prepare file download.")
    )
  }

  return (await response.json()) as SubmissionFileDownload
}

/**
 * Supersedes an active draft file so the same field can receive a new upload.
 *
 * @param input - Tenant, submission, and active file identifiers.
 * @returns A promise resolving after the tombstone is persisted.
 * @throws Error when the application API rejects the transition.
 */
export async function supersedeSubmissionFile(
  input: SubmissionFileRequestIdentity
): Promise<void> {
  const response = await fetch(
    `/api/submissions/${encodeURIComponent(input.submissionId)}/files/${encodeURIComponent(input.fileId)}/supersede`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: input.organizationId }),
    }
  )

  if (!response.ok) {
    throw new Error(
      await readApiErrorMessage(response, "Unable to replace submission file.")
    )
  }
}
