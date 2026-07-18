"use client"

import { RefreshCw } from "lucide-react"
import { useRouter } from "next/navigation"
import { type FormEvent, type ReactElement, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  completeDocumentUploadRequest,
  readApiErrorMessage,
  uploadFileToSignedUrl,
} from "@/components/documents/document-upload-client"
import type { CreateDocumentUploadUrlResponse } from "@/types/document"

type DocumentReplaceFormProps = {
  documentId: string
  organizationId: string
}

type PendingReplacement = {
  file: File
  uploadMetadata: CreateDocumentUploadUrlResponse
  uploadCompleted: boolean
}

/**
 * Uploads a replacement file while preserving every existing document version.
 *
 * @param props - Organization and document identifiers for the replacement flow.
 * @returns Client-side replacement upload form.
 */
export function DocumentReplaceForm({
  documentId,
  organizationId,
}: DocumentReplaceFormProps): ReactElement {
  const router = useRouter()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState<boolean>(false)
  const [pendingReplacement, setPendingReplacement] =
    useState<PendingReplacement | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)
    setIsUploading(true)

    try {
      const form = event.currentTarget
      let replacement = pendingReplacement

      if (replacement && !replacement.uploadCompleted) {
        const refreshedMetadata = await requestReplacementUploadUrl({
          documentId,
          organizationId,
          file: replacement.file,
          pendingVersionId: replacement.uploadMetadata.versionId,
        })
        replacement = {
          ...replacement,
          uploadMetadata: refreshedMetadata,
        }
        setPendingReplacement(replacement)
      }

      if (!replacement) {
        const formData = new FormData(form)
        const file = formData.get("replacementFile")

        if (!(file instanceof File) || file.size === 0) {
          throw new Error("Choose a replacement file.")
        }

        const uploadMetadata = await requestReplacementUploadUrl({
          documentId,
          organizationId,
          file,
        })

        replacement = { file, uploadMetadata, uploadCompleted: false }
        // Retain the allocation before PUT so transient upload failures reuse it.
        setPendingReplacement(replacement)
      }

      if (!replacement.uploadCompleted) {
        await uploadFileToSignedUrl(
          replacement.uploadMetadata.uploadUrl,
          replacement.file,
          "Unable to upload the replacement file to storage."
        )
        replacement = { ...replacement, uploadCompleted: true }
        // Retain the completed PUT so an ambiguous completion can be retried.
        setPendingReplacement(replacement)
      }

      await completeDocumentUploadRequest(
        replacement.uploadMetadata,
        organizationId,
        "Unable to complete replacement."
      )

      setPendingReplacement(null)
      form.reset()
      setSuccessMessage("Replacement uploaded. The previous version is still available.")
      router.refresh()
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to replace document."
      )
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
      <Field>
        <FieldLabel htmlFor="replacement-file">Replacement file</FieldLabel>
        <Input
          accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv"
          disabled={isUploading || Boolean(pendingReplacement)}
          id="replacement-file"
          name="replacementFile"
          required
          type="file"
        />
        <FieldDescription>
          {pendingReplacement
            ? pendingReplacement.uploadCompleted
              ? "The file is uploaded. Retry completion without creating another version."
              : "The version is reserved. Retry the same upload without creating another version."
            : "The current file stays in version history."}
        </FieldDescription>
      </Field>

      {errorMessage && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      )}

      {successMessage && (
        <p className="text-sm text-muted-foreground" role="status">
          {successMessage}
        </p>
      )}

      <Button disabled={isUploading} type="submit" variant="outline">
        <RefreshCw data-icon="inline-start" />
        {isUploading
          ? pendingReplacement
            ? pendingReplacement.uploadCompleted
              ? "Completing replacement"
              : "Uploading replacement"
            : "Uploading replacement"
          : pendingReplacement
            ? pendingReplacement.uploadCompleted
              ? "Retry completion"
              : "Retry upload"
            : "Replace file"}
      </Button>
    </form>
  )
}

async function requestReplacementUploadUrl(input: {
  documentId: string
  organizationId: string
  file: File
  pendingVersionId?: string
}): Promise<CreateDocumentUploadUrlResponse> {
  const response = await fetch(
    `/api/documents/${input.documentId}/replace-upload-url`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: input.organizationId,
        pendingVersionId: input.pendingVersionId,
        originalFilename: input.file.name,
        contentType: input.file.type,
        byteSize: input.file.size,
      }),
    }
  )

  if (!response.ok) {
    throw new Error(
      await readApiErrorMessage(response, "Unable to prepare replacement.")
    )
  }

  return (await response.json()) as CreateDocumentUploadUrlResponse
}
