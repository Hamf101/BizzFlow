"use client"

import { Upload } from "lucide-react"
import { useRouter } from "next/navigation"
import { type FormEvent, type ReactElement, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type {
  CreateDocumentUploadUrlResponse,
  DocumentFolder,
} from "@/types/document"

type DocumentUploadFormProps = {
  organizationId: string
  folders: DocumentFolder[]
}

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:bg-input/30"

/**
 * Uploads a document through the signed URL API workflow.
 *
 * @param props - Organization and available folders for document placement.
 * @returns Client-side upload form.
 */
export function DocumentUploadForm({
  organizationId,
  folders,
}: DocumentUploadFormProps): ReactElement {
  const router = useRouter()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState<boolean>(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setErrorMessage(null)
    setIsUploading(true)

    try {
      const formData = new FormData(event.currentTarget)
      const file = formData.get("file")

      if (!(file instanceof File)) {
        throw new Error("Choose a file to upload.")
      }

      const uploadMetadata = await requestUploadUrl(formData, file, organizationId)

      await uploadFileToR2(uploadMetadata.uploadUrl, file)
      await completeUpload(uploadMetadata, organizationId)

      router.push(`/documents/${uploadMetadata.documentId}`)
      router.refresh()
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to upload document."
      )
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="document-title">Title</FieldLabel>
          <Input
            id="document-title"
            maxLength={180}
            minLength={1}
            name="title"
            required
            type="text"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="document-description">Description</FieldLabel>
          <Input
            id="document-description"
            maxLength={240}
            name="description"
            type="text"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="document-folder">Folder</FieldLabel>
          <select className={selectClassName} id="document-folder" name="folderId">
            <option value="">No folder</option>
            {folders.map((folder: DocumentFolder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="document-file">File</FieldLabel>
          <Input
            accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv"
            id="document-file"
            name="file"
            required
            type="file"
          />
          <FieldDescription>
            PDF, PNG, JPG, DOCX, XLSX, or CSV.
          </FieldDescription>
        </Field>
      </FieldGroup>

      {errorMessage && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      )}

      <Button disabled={isUploading} type="submit">
        <Upload data-icon="inline-start" />
        {isUploading ? "Uploading" : "Upload document"}
      </Button>
    </form>
  )
}

async function requestUploadUrl(
  formData: FormData,
  file: File,
  organizationId: string
): Promise<CreateDocumentUploadUrlResponse> {
  const response = await fetch("/api/documents/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organizationId,
      folderId: getFormValue(formData, "folderId") || null,
      title: getFormValue(formData, "title"),
      description: getFormValue(formData, "description") || null,
      originalFilename: file.name,
      contentType: file.type,
      byteSize: file.size,
    }),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Unable to prepare upload."))
  }

  return (await response.json()) as CreateDocumentUploadUrlResponse
}

async function uploadFileToR2(uploadUrl: string, file: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type },
    body: file,
  })

  if (!response.ok) {
    throw new Error("Unable to upload file to storage.")
  }
}

async function completeUpload(
  uploadMetadata: CreateDocumentUploadUrlResponse,
  organizationId: string
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
    throw new Error(await readErrorMessage(response, "Unable to complete upload."))
  }
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

function getFormValue(formData: FormData, key: string): string {
  const value = formData.get(key)

  return typeof value === "string" ? value.trim() : ""
}
