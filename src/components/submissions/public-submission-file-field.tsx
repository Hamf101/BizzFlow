"use client"

import { Trash2, Upload } from "lucide-react"
import {
  type ChangeEvent,
  type ReactElement,
  useId,
  useRef,
  useState,
} from "react"

import { uploadFileToSignedUrl } from "@/components/documents/document-upload-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import type { TemplateBlock } from "@/types/template"

import {
  checkpointPublicFormDraft,
  completePublicFormFileUpload,
  requestPublicFormFileUpload,
  supersedePublicFormFile,
} from "./public-form-file-client"
import {
  calculateSubmissionFileChecksum,
  resolveSubmissionFileContentType,
} from "./submission-file-client"

const SUBMISSION_FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv"

type PublicSubmissionFileFieldProps = {
  answers: Readonly<Record<string, unknown>>
  block: Extract<TemplateBlock, { type: "file_field" }>
  initialFile?: {
    fileId: string
    originalFilename: string
  }
  onFileChange: (
    file: { fileId: string; originalFilename: string } | null
  ) => void
  onFilesCheckpointed: (activeFieldKeys: readonly string[]) => void
  token: string
}

/**
 * Manages a token-scoped public file through checkpoint, upload, and removal.
 *
 * @param props - Current answers, canonical file field, persisted file, and token.
 * @returns File selection or verified-file controls for the visible field.
 */
export function PublicSubmissionFileField({
  answers,
  block,
  initialFile,
  onFileChange,
  onFilesCheckpointed,
  token,
}: PublicSubmissionFileFieldProps): ReactElement {
  const inputId = useId()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState<boolean>(false)
  const uploadedFile = initialFile ?? null

  /**
   * The form's hidden `draftToken` input is the shared session handle: every
   * file field on the page reads and writes it, so one draft submission
   * parents all of their uploads.
   */
  function draftTokenInput(): HTMLInputElement | null {
    return (
      containerRef.current
        ?.closest("form")
        ?.querySelector<HTMLInputElement>('input[name="draftToken"]') ?? null
    )
  }

  /** Returns the form's optimistic public draft revision field. */
  function draftRevisionInput(): HTMLInputElement | null {
    return (
      containerRef.current
        ?.closest("form")
        ?.querySelector<HTMLInputElement>('input[name="draftRevision"]') ?? null
    )
  }

  async function handleUpload(): Promise<void> {
    if (!selectedFile) {
      setErrorMessage("Choose a file to upload.")
      return
    }

    // Client-side size check (20 MB limit)
    const MAX_FILE_SIZE = 20 * 1024 * 1024
    if (selectedFile.size > MAX_FILE_SIZE) {
      setErrorMessage("File exceeds the 20 MB size limit.")
      return
    }

    setErrorMessage(null)
    setIsUploading(true)
    let pendingAllocation: { draftToken: string; fileId: string } | null = null

    try {
      const contentType = resolveSubmissionFileContentType(selectedFile)
      const checksumSha256 = await calculateSubmissionFileChecksum(selectedFile)
      
      const tokenInput = draftTokenInput()
      const revisionInput = draftRevisionInput()
      const currentDraftToken = tokenInput?.value || null
      const currentDraftRevision = readDraftRevision(
        revisionInput?.value ?? "",
        currentDraftToken
      )
      const checkpoint = await checkpointPublicFormDraft({
        token,
        draftToken: currentDraftToken,
        draftRevision: currentDraftRevision,
        answers,
      })

      if (tokenInput) {
        tokenInput.value = checkpoint.draftToken
      }

      if (revisionInput) {
        revisionInput.value = String(checkpoint.revision)
      }

      onFilesCheckpointed(checkpoint.activeFileFieldKeys)

      const allocation = await requestPublicFormFileUpload({
        token,
        draftToken: checkpoint.draftToken,
        fieldKey: block.fieldKey,
        originalFilename: selectedFile.name,
        contentType,
        byteSize: selectedFile.size,
        checksumSha256,
      })
      pendingAllocation = {
        draftToken: checkpoint.draftToken,
        fileId: allocation.fileId,
      }

      await uploadFileToSignedUrl(
        allocation.uploadUrl,
        selectedFile,
        "Unable to upload submission file to storage.",
        contentType
      )

      // The server re-reads the stored object and must agree on size, type, and
      // checksum before this file counts toward the submission.
      await completePublicFormFileUpload({
        token,
        draftToken: checkpoint.draftToken,
        fileId: allocation.fileId,
      })
      pendingAllocation = null

      onFileChange({
        fileId: allocation.fileId,
        originalFilename: selectedFile.name,
      })
      setSelectedFile(null)
    } catch (error: unknown) {
      if (pendingAllocation) {
        try {
          await supersedePublicFormFile({
            token,
            draftToken: pendingAllocation.draftToken,
            fileId: pendingAllocation.fileId,
          })
        } catch (cleanupError: unknown) {
          console.warn("public_form_file_cleanup_deferred", {
            fieldKey: block.fieldKey,
            fileId: pendingAllocation.fileId,
            reason:
              cleanupError instanceof Error
                ? cleanupError.name
                : "Unknown cleanup error",
          })
        }
      }

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to upload submission file."
      )
    } finally {
      setIsUploading(false)
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    setErrorMessage(null)
    setSelectedFile(event.target.files?.item(0) ?? null)
  }

  async function handleRemove(): Promise<void> {
    if (!uploadedFile) {
      return
    }

    const currentDraftToken = draftTokenInput()?.value

    if (!currentDraftToken) {
      setErrorMessage("This form session must be reloaded before removing files.")
      return
    }

    setErrorMessage(null)
    setIsUploading(true)

    try {
      await supersedePublicFormFile({
        token,
        draftToken: currentDraftToken,
        fileId: uploadedFile.fileId,
      })
      onFileChange(null)
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to remove this file."
      )
    } finally {
      setIsUploading(false)
    }
  }
  
  return (
    <Field data-public-form-field-key={block.fieldKey} ref={containerRef}>
      <FieldLabel htmlFor={inputId}>
        {block.label}
        {block.required && <span className="text-destructive ml-1">*</span>}
      </FieldLabel>
      
      {uploadedFile ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{uploadedFile.originalFilename}</p>
              <p className="text-xs text-muted-foreground">
                Uploaded and verified
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={isUploading}
                onClick={() => void handleRemove()}
                size="sm"
                type="button"
                variant="outline"
              >
                <Trash2 data-icon="inline-start" />
                {isUploading ? "Removing" : "Remove"}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border px-4 py-4">
          <div className="flex flex-col gap-2">
            <Input
              accept={SUBMISSION_FILE_ACCEPT}
              disabled={isUploading}
              id={inputId}
              onChange={handleFileChange}
              type="file"
            />
            <p className="text-xs text-muted-foreground">
              PDF, PNG, JPG, DOCX, XLSX, or CSV. Maximum 20 MB.
            </p>
          </div>
          <div>
            <Button
              disabled={!selectedFile || isUploading}
              onClick={handleUpload}
              size="sm"
              type="button"
              variant="outline"
            >
              <Upload data-icon="inline-start" />
              {isUploading ? "Uploading" : "Upload file"}
            </Button>
          </div>
        </div>
      )}

      {errorMessage && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      )}
      
      {block.helpText && (
        <FieldDescription>{block.helpText}</FieldDescription>
      )}
    </Field>
  )
}

function readDraftRevision(
  rawRevision: string,
  draftToken: string | null
): number | null {
  if (!draftToken) {
    return null
  }

  const revision = Number(rawRevision)

  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error("This form session must be reloaded before uploading files.")
  }

  return revision
}
