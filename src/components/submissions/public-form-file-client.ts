"use client"

import { readApiErrorMessage } from "@/components/documents/document-upload-client"

export type PublicFormDraftCheckpoint = {
  activeFileFieldKeys: string[]
  draftToken: string
  revision: number
}

export type PublicFormFileUploadAllocation = {
  draftToken: string
  expiresInSeconds: number
  fileId: string
  safeFilename: string
  storageKey: string
  uploadUrl: string
}

type CheckpointPublicFormDraftInput = {
  answers: Readonly<Record<string, unknown>>
  draftRevision: number | null
  draftToken: string | null
  token: string
}

type RequestPublicFormFileUploadInput = {
  byteSize: number
  checksumSha256: string
  contentType: string
  draftToken: string
  fieldKey: string
  originalFilename: string
  token: string
}

type CompletePublicFormFileUploadInput = {
  draftToken: string
  fileId: string
  token: string
}

type SupersedePublicFormFileInput = CompletePublicFormFileUploadInput

/**
 * Persists current scalar answers before a conditional file is allocated.
 *
 * @param input - Link token, optimistic draft identity, and browser answers.
 * @returns Current draft token and revision.
 * @throws Error when the checkpoint API rejects validation or stale state.
 */
export async function checkpointPublicFormDraft(
  input: CheckpointPublicFormDraftInput
): Promise<PublicFormDraftCheckpoint> {
  const response = await fetch(
    `/api/public-forms/${encodeURIComponent(input.token)}/draft`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draftToken: input.draftToken,
        expectedRevision: input.draftRevision,
        values: input.answers,
      }),
    }
  )

  if (!response.ok) {
    throw new Error(
      await readApiErrorMessage(response, "Unable to save your form draft.")
    )
  }

  return (await response.json()) as PublicFormDraftCheckpoint
}

/**
 * Requests a create-only upload URL for a checkpointed public draft.
 *
 * @param input - Draft identity and validated browser file metadata.
 * @returns Signed upload allocation.
 * @throws Error when the allocation API rejects the request.
 */
export async function requestPublicFormFileUpload(
  input: RequestPublicFormFileUploadInput
): Promise<PublicFormFileUploadAllocation> {
  const response = await fetch(
    `/api/public-forms/${encodeURIComponent(input.token)}/file-upload-url`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draftToken: input.draftToken,
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
      await readApiErrorMessage(response, "Unable to request file upload.")
    )
  }

  return (await response.json()) as PublicFormFileUploadAllocation
}

/**
 * Requests server-side verification for one uploaded public draft object.
 *
 * @param input - Link token, draft handle, and allocated file id.
 * @returns A promise resolving once the file is available.
 * @throws Error when stored object verification fails.
 */
export async function completePublicFormFileUpload(
  input: CompletePublicFormFileUploadInput
): Promise<void> {
  const response = await fetch(
    `/api/public-forms/${encodeURIComponent(input.token)}/file-complete`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draftToken: input.draftToken,
        fileId: input.fileId,
      }),
    }
  )

  if (!response.ok) {
    throw new Error(
      await readApiErrorMessage(
        response,
        "Your upload could not be verified. Try again."
      )
    )
  }
}

/**
 * Moves an active public draft file into recoverable superseded cleanup.
 *
 * @param input - Link token, draft handle, and active file id.
 * @returns A promise resolving after the database transition succeeds.
 * @throws Error when the file is stale or outside this draft.
 */
export async function supersedePublicFormFile(
  input: SupersedePublicFormFileInput
): Promise<void> {
  const response = await fetch(
    `/api/public-forms/${encodeURIComponent(input.token)}/file-supersede`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draftToken: input.draftToken,
        fileId: input.fileId,
      }),
    }
  )

  if (!response.ok) {
    throw new Error(
      await readApiErrorMessage(response, "Unable to remove this file.")
    )
  }
}
