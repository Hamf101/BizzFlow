import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type HeadObjectCommandOutput,
  type S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import {
  getFileUploadPolicyEnv,
  getR2Env,
  type FileUploadPolicyEnv,
  type R2Env,
} from "@/lib/env"
import { createR2Client } from "@/lib/r2/client"

const DOCUMENT_CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/csv": ".csv",
}

type DocumentStorageCommand = PutObjectCommand | GetObjectCommand

export type DocumentStorageSigner = (
  client: S3Client,
  command: DocumentStorageCommand,
  options: {
    expiresIn: number
    signableHeaders?: Set<string>
  }
) => Promise<string>

export type DocumentStorageHeadObject = (
  client: S3Client,
  command: HeadObjectCommand
) => Promise<HeadObjectCommandOutput>

export type BuildDocumentObjectKeyInput = {
  organizationId: string
  documentId: string
  versionId: string
  contentType: string
}

export type ValidateDocumentUploadRequestInput = {
  contentType: string
  byteSize: number
}

export type CreateSignedDocumentUploadUrlInput = BuildDocumentObjectKeyInput &
  ValidateDocumentUploadRequestInput

export type CreateSignedDocumentDownloadUrlInput = {
  storageKey: string
}

export type VerifyDocumentUploadInput = {
  storageKey: string
  contentType: string
  byteSize: number
}

export type SignedDocumentUploadUrl = {
  uploadUrl: string
  storageKey: string
  expiresInSeconds: number
}

export type SignedDocumentDownloadUrl = {
  downloadUrl: string
  expiresInSeconds: number
}

export type DocumentStorageServiceDeps = {
  r2Client?: S3Client
  r2Env?: R2Env
  fileUploadPolicy?: FileUploadPolicyEnv
  signer?: DocumentStorageSigner
  headObject?: DocumentStorageHeadObject
}

/**
 * Error type raised by document storage service operations.
 */
export class DocumentStorageServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates a document storage service error with an HTTP-style status code.
   *
   * @param message - User-safe error message.
   * @param statusCode - HTTP-style status code for route/action translation.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "DocumentStorageServiceError"
    this.statusCode = statusCode
  }
}

/**
 * Builds the deterministic R2 object key for an original document version.
 *
 * @param input - Tenant, document, version, and content type identifiers.
 * @returns Deterministic object key with a safe extension derived from MIME type.
 * @throws DocumentStorageServiceError when the content type has no safe extension.
 */
export function buildDocumentObjectKey(
  input: BuildDocumentObjectKeyInput
): string {
  const extension = getSafeExtensionForContentType(input.contentType)

  return [
    "organizations",
    input.organizationId,
    "documents",
    input.documentId,
    "versions",
    input.versionId,
    `original${extension}`,
  ].join("/")
}

/**
 * Validates an upload request against configured MIME type and byte-size policy.
 *
 * @param input - Upload content type and byte size.
 * @param fileUploadPolicy - Optional prevalidated policy for tests.
 * @throws DocumentStorageServiceError when content type or byte size is invalid.
 */
export function validateDocumentUploadRequest(
  input: ValidateDocumentUploadRequestInput,
  fileUploadPolicy: FileUploadPolicyEnv = getFileUploadPolicyEnv()
): void {
  if (!fileUploadPolicy.FILE_UPLOAD_ALLOWED_MIME_TYPES.includes(input.contentType)) {
    throw new DocumentStorageServiceError(
      "Document content type is not allowed.",
      400
    )
  }

  if (
    !Number.isInteger(input.byteSize) ||
    input.byteSize < 1 ||
    input.byteSize > fileUploadPolicy.FILE_UPLOAD_MAX_BYTES
  ) {
    throw new DocumentStorageServiceError(
      "Document byte size is outside the allowed range.",
      400
    )
  }
}

/**
 * Creates a signed R2 PUT URL for uploading an original document version.
 *
 * @param input - Document identifiers plus upload content type and byte size.
 * @param deps - Optional R2, policy, and signer dependencies for tests.
 * @returns Signed upload URL metadata and deterministic storage key.
 * @throws DocumentStorageServiceError when validation or signing fails.
 */
export async function createSignedDocumentUploadUrl(
  input: CreateSignedDocumentUploadUrlInput,
  deps: DocumentStorageServiceDeps = {}
): Promise<SignedDocumentUploadUrl> {
  try {
    const fileUploadPolicy = deps.fileUploadPolicy ?? getFileUploadPolicyEnv()

    validateDocumentUploadRequest(input, fileUploadPolicy)

    const storageKey = buildDocumentObjectKey(input)
    const r2Env = deps.r2Env ?? getR2Env()
    const r2Client = deps.r2Client ?? createR2Client(r2Env)
    const signer = deps.signer ?? signDocumentStorageCommand
    const command = new PutObjectCommand({
      Bucket: r2Env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: storageKey,
      ContentLength: input.byteSize,
      ContentType: input.contentType,
      IfNoneMatch: "*",
    })
    const uploadUrl = await signer(r2Client, command, {
      expiresIn: r2Env.CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS,
      signableHeaders: new Set(["content-type"]),
    })

    return {
      uploadUrl,
      storageKey,
      expiresInSeconds: r2Env.CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS,
    }
  } catch (error: unknown) {
    if (error instanceof DocumentStorageServiceError) {
      throw error
    }

    throw new DocumentStorageServiceError(
      "Unable to create signed document upload URL.",
      500
    )
  }
}

/**
 * Creates a signed R2 GET URL for downloading a stored document object.
 *
 * @param input - Stored R2 object key for the document version.
 * @param deps - Optional R2 and signer dependencies for tests.
 * @returns Signed download URL metadata.
 * @throws DocumentStorageServiceError when the storage key is invalid or signing fails.
 */
export async function createSignedDocumentDownloadUrl(
  input: CreateSignedDocumentDownloadUrlInput,
  deps: DocumentStorageServiceDeps = {}
): Promise<SignedDocumentDownloadUrl> {
  try {
    if (input.storageKey.trim().length === 0) {
      throw new DocumentStorageServiceError(
        "Document storage key is required.",
        400
      )
    }

    const r2Env = deps.r2Env ?? getR2Env()
    const r2Client = deps.r2Client ?? createR2Client(r2Env)
    const signer = deps.signer ?? signDocumentStorageCommand
    const command = new GetObjectCommand({
      Bucket: r2Env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: input.storageKey,
      ResponseContentDisposition: "attachment",
    })
    const downloadUrl = await signer(r2Client, command, {
      expiresIn: r2Env.CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS,
    })

    return {
      downloadUrl,
      expiresInSeconds: r2Env.CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS,
    }
  } catch (error: unknown) {
    if (error instanceof DocumentStorageServiceError) {
      throw error
    }

    throw new DocumentStorageServiceError(
      "Unable to create signed document download URL.",
      500
    )
  }
}

/**
 * Verifies that an uploaded R2 object exists and matches its pending version.
 *
 * The content type comparison ignores casing, surrounding whitespace, and MIME
 * parameters such as a charset while retaining an exact byte-size comparison.
 *
 * @param input - Stored object key and the expected upload metadata.
 * @param deps - Optional R2 client, environment, and HEAD executor for tests.
 * @returns A promise that resolves after the object metadata is verified.
 * @throws DocumentStorageServiceError with status 400 for invalid input, 409
 * when the object is missing or its metadata differs, and 500 when R2 cannot be
 * queried.
 */
export async function verifyDocumentUpload(
  input: VerifyDocumentUploadInput,
  deps: DocumentStorageServiceDeps = {}
): Promise<void> {
  const startedAt = Date.now()
  const storageKey = input.storageKey.trim()

  try {
    validateDocumentUploadVerificationInput({
      ...input,
      storageKey,
    })

    const r2Env = deps.r2Env ?? getR2Env()
    const r2Client = deps.r2Client ?? createR2Client(r2Env)
    const headObject = deps.headObject ?? headDocumentStorageObject
    const command = new HeadObjectCommand({
      Bucket: r2Env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: storageKey,
    })
    const objectMetadata = await headObject(r2Client, command)

    if (objectMetadata.ContentLength !== input.byteSize) {
      throw new DocumentStorageServiceError(
        "Uploaded document byte size does not match the pending version.",
        409
      )
    }

    if (
      normalizeContentType(objectMetadata.ContentType) !==
      normalizeContentType(input.contentType)
    ) {
      throw new DocumentStorageServiceError(
        "Uploaded document content type does not match the pending version.",
        409
      )
    }

    console.info("document_upload_verification_completed", {
      storageKey,
      durationMs: Date.now() - startedAt,
    })
  } catch (error: unknown) {
    if (error instanceof DocumentStorageServiceError) {
      console.warn("document_upload_verification_rejected", {
        storageKey,
        statusCode: error.statusCode,
        durationMs: Date.now() - startedAt,
      })
      throw error
    }

    if (isDocumentObjectNotFoundError(error)) {
      console.warn("document_upload_verification_rejected", {
        storageKey,
        statusCode: 409,
        durationMs: Date.now() - startedAt,
      })
      throw new DocumentStorageServiceError(
        "Uploaded document object was not found.",
        409
      )
    }

    console.error("document_upload_verification_failed", {
      storageKey,
      durationMs: Date.now() - startedAt,
    })
    throw new DocumentStorageServiceError(
      "Unable to verify uploaded document object.",
      500
    )
  }
}

function getSafeExtensionForContentType(contentType: string): string {
  const extension = DOCUMENT_CONTENT_TYPE_EXTENSIONS[contentType]

  if (!extension) {
    throw new DocumentStorageServiceError(
      "Document content type does not have a supported storage extension.",
      400
    )
  }

  return extension
}

function validateDocumentUploadVerificationInput(
  input: VerifyDocumentUploadInput
): void {
  if (input.storageKey.length === 0) {
    throw new DocumentStorageServiceError(
      "Document storage key is required.",
      400
    )
  }

  if (normalizeContentType(input.contentType).length === 0) {
    throw new DocumentStorageServiceError(
      "Document content type is required.",
      400
    )
  }

  if (!Number.isInteger(input.byteSize) || input.byteSize < 1) {
    throw new DocumentStorageServiceError(
      "Document byte size must be a positive integer.",
      400
    )
  }
}

function normalizeContentType(contentType: string | undefined): string {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? ""
}

function isDocumentObjectNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false
  }

  const candidate = error as {
    name?: unknown
    code?: unknown
    Code?: unknown
    $metadata?: { httpStatusCode?: unknown }
  }
  const errorCodes = [candidate.name, candidate.code, candidate.Code]

  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    errorCodes.some(
      (errorCode: unknown): boolean =>
        errorCode === "NotFound" ||
        errorCode === "NoSuchKey" ||
        errorCode === "NoSuchObject"
    )
  )
}

async function headDocumentStorageObject(
  client: S3Client,
  command: HeadObjectCommand
): Promise<HeadObjectCommandOutput> {
  return client.send(command)
}

async function signDocumentStorageCommand(
  client: S3Client,
  command: DocumentStorageCommand,
  options: {
    expiresIn: number
    signableHeaders?: Set<string>
  }
): Promise<string> {
  return getSignedUrl(client, command, options)
}
