import { createHash } from "node:crypto"

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type GetObjectCommandOutput,
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
import {
  hasAllowedFileSignature,
  SIGNED_URL_MAX_TTL_SECONDS,
  UUID_PATTERN,
} from "@/lib/r2/stored-file"
import { ServiceError } from "@/services/service-error"
import { isR2NotFound, signCreateOnlyPut } from "@/services/r2-objects"

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
    signingDate?: Date
  }
) => Promise<string>

export type DocumentStorageGetObject = (
  client: S3Client,
  command: GetObjectCommand
) => Promise<GetObjectCommandOutput>

export type DocumentStorageDeleteObject = (
  client: S3Client,
  command: DeleteObjectCommand
) => Promise<void>

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
  /** The name a saved copy takes, made safe before it is signed. */
  downloadFilename: string
  /** Shown in the browser as this type, rather than saved. */
  viewAs?: string
}

export type VerifyDocumentUploadInput = {
  storageKey: string
  contentType: string
  byteSize: number
}

export type DeleteDocumentStorageObjectInput = {
  storageKey: string
}

export type SignedDocumentUploadUrl = {
  uploadUrl: string
  storageKey: string
  expiresInSeconds: number
  expiresAt: string
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
  getObject?: DocumentStorageGetObject
  deleteObject?: DocumentStorageDeleteObject
  now?: () => Date
}

/**
 * Error type raised by document storage service operations.
 */
export class DocumentStorageServiceError extends ServiceError {
  override readonly name = "DocumentStorageServiceError"
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
  if (
    ![input.organizationId, input.documentId, input.versionId].every(
      (id: string): boolean => UUID_PATTERN.test(id)
    )
  ) {
    throw new DocumentStorageServiceError(
      "Document storage identifiers are invalid.",
      400
    )
  }

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
    const signingDate = new Date((deps.now?.() ?? new Date()).getTime())
    const expiresInSeconds = Math.min(
      r2Env.CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS,
      SIGNED_URL_MAX_TTL_SECONDS
    )
    const expiresAt = new Date(
      signingDate.getTime() + expiresInSeconds * 1_000
    ).toISOString()
    const uploadUrl = await signCreateOnlyPut(signer, r2Client, {
      bucket: r2Env.CLOUDFLARE_R2_BUCKET_NAME,
      key: storageKey,
      byteSize: input.byteSize,
      contentType: input.contentType,
      expiresIn: expiresInSeconds,
      signingDate,
    })

    return {
      uploadUrl,
      storageKey,
      expiresInSeconds,
      expiresAt,
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
    // Only a key this service could have stored is ever signed.
    if (!isSafeDocumentStorageKey(input.storageKey)) {
      throw new DocumentStorageServiceError(
        "Document storage key is invalid.",
        400
      )
    }

    const r2Env = deps.r2Env ?? getR2Env()
    const r2Client = deps.r2Client ?? createR2Client(r2Env)
    const signer = deps.signer ?? signDocumentStorageCommand
    const expiresInSeconds = Math.min(
      r2Env.CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS,
      SIGNED_URL_MAX_TTL_SECONDS
    )
    const command = new GetObjectCommand({
      Bucket: r2Env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: input.storageKey,
      ResponseContentDisposition: input.viewAs
        ? "inline"
        : `attachment; filename="${toSafeDownloadFilename(input.downloadFilename)}"`,
      ResponseContentType: input.viewAs,
    })
    const downloadUrl = await signer(r2Client, command, { expiresIn: expiresInSeconds })

    return { downloadUrl, expiresInSeconds }
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
 * Reads an uploaded R2 object back and checks it is the file its pending
 * version claims: the exact size and type, and bytes with that type's
 * signature (a macro workbook or a renamed program is refused).
 *
 * The content type comparison ignores casing, surrounding whitespace, and MIME
 * parameters such as a charset while retaining an exact byte-size comparison.
 *
 * @param input - Stored object key and the expected upload metadata.
 * @param deps - Optional R2 client, environment, and GET executor for tests.
 * @returns The SHA-256 of the verified bytes, in hex.
 * @throws DocumentStorageServiceError with status 400 for invalid input, 409
 * when the object is missing or differs from its version, and 500 when R2
 * cannot be read.
 */
export async function verifyDocumentUpload(
  input: VerifyDocumentUploadInput,
  deps: DocumentStorageServiceDeps = {}
): Promise<string> {
  const startedAt = Date.now()
  const storageKey = input.storageKey.trim()

  try {
    validateDocumentUploadVerificationInput({
      ...input,
      storageKey,
    })

    const r2Env = deps.r2Env ?? getR2Env()
    const r2Client = deps.r2Client ?? createR2Client(r2Env)
    const getObject = deps.getObject ?? getDocumentStorageObject
    const command = new GetObjectCommand({
      Bucket: r2Env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: storageKey,
    })
    const storedObject = await getObject(r2Client, command)

    if (storedObject.ContentLength !== input.byteSize) {
      throw new DocumentStorageServiceError(
        "Uploaded document byte size does not match the pending version.",
        409
      )
    }

    if (
      normalizeContentType(storedObject.ContentType) !==
      normalizeContentType(input.contentType)
    ) {
      throw new DocumentStorageServiceError(
        "Uploaded document content type does not match the pending version.",
        409
      )
    }

    const bytes = await storedObject.Body?.transformToByteArray()

    if (!bytes || bytes.byteLength !== input.byteSize) {
      throw new DocumentStorageServiceError(
        "Uploaded document bytes do not match the pending version.",
        409
      )
    }

    if (!hasAllowedFileSignature(bytes, normalizeContentType(input.contentType))) {
      throw new DocumentStorageServiceError(
        "Uploaded document bytes do not match an allowed file format.",
        409
      )
    }

    console.info("document_upload_verification_completed", {
      durationMs: Date.now() - startedAt,
    })

    return createHash("sha256").update(bytes).digest("hex")
  } catch (error: unknown) {
    if (error instanceof DocumentStorageServiceError) {
      console.warn("document_upload_verification_rejected", {
        statusCode: error.statusCode,
        durationMs: Date.now() - startedAt,
      })
      throw error
    }

    if (isR2NotFound(error)) {
      console.warn("document_upload_verification_rejected", {
        statusCode: 409,
        durationMs: Date.now() - startedAt,
      })
      throw new DocumentStorageServiceError(
        "Uploaded document object was not found.",
        409
      )
    }

    console.error("document_upload_verification_failed", {
      durationMs: Date.now() - startedAt,
    })
    throw new DocumentStorageServiceError(
      "Unable to verify uploaded document object.",
      500
    )
  }
}

/**
 * Deletes one persisted document object from private R2 storage.
 *
 * R2/S3 DELETE is idempotent. A provider-specific not-found response is also
 * treated as success so a retry can safely reconcile an already deleted key.
 * Raw storage keys are intentionally excluded from every log and error.
 *
 * @param input - Exact object key loaded from the purge outbox.
 * @param deps - Optional R2 client, environment, and delete executor for tests.
 * @returns A promise that resolves once the object is absent.
 * @throws DocumentStorageServiceError with status 400 for an empty key or 500
 * when R2 cannot confirm the delete.
 */
export async function deleteDocumentStorageObject(
  input: DeleteDocumentStorageObjectInput,
  deps: DocumentStorageServiceDeps = {}
): Promise<void> {
  const startedAt = Date.now()
  const storageKey = input.storageKey.trim()

  try {
    if (storageKey.length === 0) {
      throw new DocumentStorageServiceError(
        "Document storage key is required.",
        400
      )
    }

    const r2Env = deps.r2Env ?? getR2Env()
    const r2Client = deps.r2Client ?? createR2Client(r2Env)
    const deleteObject =
      deps.deleteObject ?? deleteDocumentStorageObjectCommand
    const command = new DeleteObjectCommand({
      Bucket: r2Env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: storageKey,
    })

    await deleteObject(r2Client, command)
    console.info("document_storage_object_deleted", {
      durationMs: Date.now() - startedAt,
    })
  } catch (error: unknown) {
    if (isR2NotFound(error)) {
      console.info("document_storage_object_already_absent", {
        durationMs: Date.now() - startedAt,
      })
      return
    }

    if (error instanceof DocumentStorageServiceError) {
      console.warn("document_storage_object_delete_rejected", {
        statusCode: error.statusCode,
        durationMs: Date.now() - startedAt,
      })
      throw error
    }

    console.error("document_storage_object_delete_failed", {
      durationMs: Date.now() - startedAt,
    })
    throw new DocumentStorageServiceError(
      "Unable to delete document storage object.",
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

// An uploaded original's key, or a generated document's finalized PDF.
function isSafeDocumentStorageKey(storageKey: string): boolean {
  const [root, orgId, documents, documentId, kind, id, filename, ...rest] =
    storageKey.split("/")

  return (
    rest.length === 0 &&
    root === "organizations" &&
    documents === "documents" &&
    [orgId, documentId, id].every((segment?: string): boolean => UUID_PATTERN.test(segment ?? "")) &&
    ((kind === "versions" &&
      Object.values(DOCUMENT_CONTENT_TYPE_EXTENSIONS).some(
        (extension: string): boolean => filename === `original${extension}`
      )) ||
      (kind === "finalizations" && filename === "final.pdf"))
  )
}

// ASCII letters, digits, dots, dashes and underscores only, so nothing a
// filename holds can end the header or add another.
function toSafeDownloadFilename(filename: string): string {
  const safe = filename
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|-+$/g, "")
    .slice(-180)

  return safe || "document"
}

function validateDocumentUploadVerificationInput(
  input: VerifyDocumentUploadInput
): void {
  if (!isSafeDocumentStorageKey(input.storageKey)) {
    throw new DocumentStorageServiceError(
      "Document storage key is invalid.",
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

async function getDocumentStorageObject(
  client: S3Client,
  command: GetObjectCommand
): Promise<GetObjectCommandOutput> {
  return client.send(command)
}

async function deleteDocumentStorageObjectCommand(
  client: S3Client,
  command: DeleteObjectCommand
): Promise<void> {
  await client.send(command)
}

async function signDocumentStorageCommand(
  client: S3Client,
  command: DocumentStorageCommand,
  options: {
    expiresIn: number
    signableHeaders?: Set<string>
    signingDate?: Date
  }
): Promise<string> {
  return getSignedUrl(client, command, options)
}
