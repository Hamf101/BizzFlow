"use client"

import { Download, RefreshCw, Trash2, Upload } from "lucide-react"
import { useRouter } from "next/navigation"
import { type ChangeEvent, type ReactElement, useId, useState } from "react"

import { uploadFileToSignedUrl } from "@/components/documents/document-upload-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { SubmissionFile } from "@/types/submission"

import {
  calculateSubmissionFileChecksum,
  completeSubmissionFileUpload,
  resolveSubmissionFileContentType,
  requestSubmissionFileDownload,
  requestSubmissionFileUpload,
  supersedeSubmissionFile,
} from "./submission-file-client"

const SUBMISSION_FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv"

type SubmissionFileFieldProps = {
  editable: boolean
  expectedRevision: number
  fieldKey: string
  file: SubmissionFile | null
  organizationId: string
  submissionId: string
}

/**
 * Manages one create-only cloud file attached to an internal submission field.
 *
 * @param props - Submission identity, field identity, revision, and current file.
 * @returns Upload, retry, status, and private download controls for one field.
 */
export function SubmissionFileField({
  editable,
  expectedRevision,
  fieldKey,
  file,
  organizationId,
  submissionId,
}: SubmissionFileFieldProps): ReactElement {
  const inputId = useId()
  const router = useRouter()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState<boolean>(false)
  const [isSuperseding, setIsSuperseding] = useState<boolean>(false)
  const [isUploading, setIsUploading] = useState<boolean>(false)

  async function handleUpload(): Promise<void> {
    if (!selectedFile) {
      setErrorMessage("Choose a file to upload.")
      return
    }

    setErrorMessage(null)
    setIsUploading(true)

    try {
      const contentType = resolveSubmissionFileContentType(selectedFile)
      const checksumSha256 = await calculateSubmissionFileChecksum(selectedFile)
      const allocation = await requestSubmissionFileUpload({
        byteSize: selectedFile.size,
        contentType,
        checksumSha256,
        expectedRevision,
        fieldKey,
        organizationId,
        originalFilename: selectedFile.name,
        submissionId,
      })

      await uploadFileToSignedUrl(
        allocation.uploadUrl,
        selectedFile,
        "Unable to upload submission file to storage.",
        contentType
      )
      await completeSubmissionFileUpload({
        fileId: allocation.file.id,
        organizationId,
        submissionId,
      })
      setSelectedFile(null)
      router.refresh()
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to upload submission file."
      )
    } finally {
      setIsUploading(false)
    }
  }

  async function handleSupersede(): Promise<void> {
    if (!file || !editable) {
      return
    }

    setErrorMessage(null)
    setIsSuperseding(true)

    try {
      await supersedeSubmissionFile({
        fileId: file.id,
        organizationId,
        submissionId,
      })
      setSelectedFile(null)
      router.refresh()
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to replace submission file."
      )
    } finally {
      setIsSuperseding(false)
    }
  }

  async function handleDownload(): Promise<void> {
    if (!file || file.status !== "available") {
      return
    }

    setErrorMessage(null)
    setIsDownloading(true)
    let downloadWindow: Window | null = null

    try {
      downloadWindow = window.open("about:blank", "_blank")

      if (!downloadWindow) {
        throw new Error("Allow pop-ups to download this file.")
      }

      downloadWindow.opener = null
      const result = await requestSubmissionFileDownload({
        fileId: file.id,
        organizationId,
        submissionId,
      })
      downloadWindow.location.replace(result.downloadUrl)
    } catch (error: unknown) {
      if (downloadWindow && !downloadWindow.closed) {
        downloadWindow.close()
      }

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to download submission file."
      )
    } finally {
      setIsDownloading(false)
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    setErrorMessage(null)
    setSelectedFile(event.target.files?.item(0) ?? null)
  }

  if (file?.status === "available") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-slate-300 bg-slate-50 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{file.originalFilename}</p>
            <p className="text-xs text-slate-500">
              {formatByteSize(file.byteSize)} · Upload verified
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={isDownloading || isSuperseding}
              onClick={handleDownload}
              size="sm"
              type="button"
              variant="outline"
            >
              <Download data-icon="inline-start" />
              {isDownloading ? "Preparing" : "Download"}
            </Button>
            {editable && (
              <Button
                disabled={isDownloading || isSuperseding}
                onClick={handleSupersede}
                size="sm"
                type="button"
                variant="outline"
              >
                <RefreshCw data-icon="inline-start" />
                {isSuperseding ? "Replacing" : "Replace"}
              </Button>
            )}
          </div>
        </div>
        {errorMessage && (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
    )
  }

  if (!editable) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
        {file ? "File upload is awaiting verification." : "No file uploaded."}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-slate-300 px-4 py-4">
      {file?.status === "upload_pending" && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-amber-700">
            The earlier upload was not verified. Choose the same file to retry
            it, or cancel it and choose another.
          </p>
          <Button
            disabled={isSuperseding || isUploading}
            onClick={handleSupersede}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2 data-icon="inline-start" />
            {isSuperseding ? "Cancelling" : "Cancel upload"}
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-slate-700" htmlFor={inputId}>
          Choose file
        </label>
        <Input
          accept={SUBMISSION_FILE_ACCEPT}
          disabled={isUploading}
          id={inputId}
          onChange={handleFileChange}
          type="file"
        />
        <p className="text-xs text-slate-500">
          PDF, PNG, JPG, DOCX, XLSX, or CSV. Maximum 20 MB.
        </p>
      </div>
      <div>
        <Button
          disabled={!selectedFile || isSuperseding || isUploading}
          onClick={handleUpload}
          size="sm"
          type="button"
          variant="outline"
        >
          <Upload data-icon="inline-start" />
          {isUploading ? "Uploading" : file ? "Retry upload" : "Upload file"}
        </Button>
      </div>
      {errorMessage && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  )
}

function formatByteSize(byteSize: number): string {
  if (byteSize < 1_024) {
    return `${byteSize} B`
  }

  if (byteSize < 1_048_576) {
    return `${Math.ceil(byteSize / 1_024)} KB`
  }

  return `${(byteSize / 1_048_576).toFixed(1)} MB`
}
