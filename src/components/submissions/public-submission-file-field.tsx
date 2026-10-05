"use client"

import {
  type ChangeEvent,
  type ReactElement,
  useId,
  useRef,
  useState,
} from "react"

import { uploadFileToSignedUrl } from "@/components/documents/document-upload-client"
import { Button, buttonVariants } from "@/components/ui/button"
import { RequiredStandIn } from "@/components/ui/required-stand-in"
import { cn } from "@/lib/utils"
import type { TemplateBlock } from "@/types/template"

import {
  checkpointPublicFormDraft,
  completePublicFormFileUpload,
  requestPublicFormFileUpload,
  supersedePublicFormFile,
} from "./public-form-file-client"
import { useHoldWhileUploading } from "./public-answer-form"
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
 * What a file field's box holds on a page someone answers: no file yet and a
 * way to choose one, which uploads at once, or the file and a way to remove it.
 * The box, label and help are the paper's own.
 *
 * @param props - Current answers, canonical file field, persisted file, and token.
 * @returns The box's contents.
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState<boolean>(false)
  const uploadedFile = initialFile ?? null

  useHoldWhileUploading(isUploading)

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

  async function handleUpload(selectedFile: File): Promise<void> {
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
    const chosen = event.target.files?.item(0) ?? null
    // Cleared, so choosing the same file again after a failure tries again.
    event.target.value = ""

    if (chosen) {
      void handleUpload(chosen)
    }
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
    <div className="flex flex-col gap-1" data-public-form-field-key={block.fieldKey} ref={containerRef}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {uploadedFile ? (
          <span className="min-w-0 truncate font-medium">{uploadedFile.originalFilename}</span>
        ) : (
          <span className="text-muted-foreground">{isUploading ? "Uploading…" : "No file yet"}</span>
        )}
        {uploadedFile ? (
          <Button
            aria-label={`Remove ${uploadedFile.originalFilename}`}
            disabled={isUploading}
            onClick={() => void handleRemove()}
            size="sm"
            type="button"
            variant="ghost"
          >
            {isUploading ? "Removing…" : "Remove"}
          </Button>
        ) : (
          <label
            aria-disabled={isUploading}
            className={cn(
              buttonVariants({ size: "sm", variant: "outline" }),
              "cursor-pointer focus-within:ring-2 focus-within:ring-ring/40",
              isUploading && "pointer-events-none opacity-50"
            )}
          >
            Choose a file
            <input
              accept={SUBMISSION_FILE_ACCEPT}
              // Named as it reads, so a spoken "Choose a file" finds it.
              aria-label={`Choose a file for ${block.label}`}
              className="sr-only"
              disabled={isUploading}
              id={inputId}
              onChange={handleFileChange}
              type="file"
            />
          </label>
        )}
      </div>
      {block.required ? <RequiredStandIn filled={uploadedFile !== null} label={block.label} /> : null}
      {errorMessage ? (
        <p className="text-destructive" role="alert" style={{ fontSize: "0.8em" }}>
          {errorMessage}
        </p>
      ) : null}
    </div>
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
