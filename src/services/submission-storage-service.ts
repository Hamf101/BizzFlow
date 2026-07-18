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

/** Hard upper bound for one internal-submission file. */
export const SUBMISSION_FILE_MAX_BYTES = 20 * 1024 * 1024

/** Short maximum lifetime for a browser upload capability. */
export const SUBMISSION_UPLOAD_URL_MAX_TTL_SECONDS = 15 * 60

/** Buffer between upload URL expiry and durable orphan cleanup eligibility. */
export const SUBMISSION_UPLOAD_CLEANUP_GRACE_SECONDS = 5 * 60

/** MIME types supported by both the submission schema and R2 workflow. */
export const SUBMISSION_FILE_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
] as const

const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_OOXML_UNCOMPRESSED_BYTES = 100 * 1024 * 1024

const CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "text/csv": [".csv"],
}

type SubmissionStorageCommand = PutObjectCommand | GetObjectCommand

/** Signs one submission storage request. Injectable for focused tests. */
export type SubmissionStorageSigner = (
  client: S3Client,
  command: SubmissionStorageCommand,
  options: {
    expiresIn: number
    signableHeaders?: Set<string>
  }
) => Promise<string>

/** Executes an R2 GET request. Injectable for focused tests. */
export type SubmissionStorageGetObject = (
  client: S3Client,
  command: GetObjectCommand
) => Promise<GetObjectCommandOutput>

/** Executes an idempotent R2 object deletion. Injectable for focused tests. */
export type SubmissionStorageDeleteObject = (
  client: S3Client,
  command: DeleteObjectCommand
) => Promise<void>

/** Dependencies accepted by submission storage helpers. */
export type SubmissionStorageServiceDeps = {
  r2Client?: S3Client
  r2Env?: R2Env
  fileUploadPolicy?: FileUploadPolicyEnv
  signer?: SubmissionStorageSigner
  getObject?: SubmissionStorageGetObject
  deleteObject?: SubmissionStorageDeleteObject
}

/** Metadata needed to validate an intended submission upload. */
export type ValidateSubmissionUploadRequestInput = {
  contentType: string
  byteSize: number
  checksumSha256: string
}

/** Identifiers used to derive a canonical submission file object key. */
export type BuildSubmissionFileObjectKeyInput = {
  organizationId: string
  submissionId: string
  fieldKey: string
  fileId: string
  safeFilename: string
}

/** Input used to issue a create-only signed submission upload URL. */
export type CreateSignedSubmissionUploadUrlInput =
  BuildSubmissionFileObjectKeyInput & ValidateSubmissionUploadRequestInput

/** Input used to verify an uploaded submission object. */
export type VerifySubmissionUploadInput = {
  storageKey: string
  contentType: string
  byteSize: number
  checksumSha256: string
}

/** Input used to remove an object retained by a superseded allocation. */
export type DeleteSubmissionStorageObjectInput = {
  storageKey: string
}

/** Input used to issue a private submission file download URL. */
export type CreateSignedSubmissionDownloadUrlInput = {
  storageKey: string
  downloadFilename: string
}

/** Signed create-only upload response. */
export type SignedSubmissionUploadUrl = {
  uploadUrl: string
  storageKey: string
  expiresInSeconds: number
}

/** Signed private download response. */
export type SignedSubmissionDownloadUrl = {
  downloadUrl: string
  expiresInSeconds: number
}

/** Error raised by submission-specific R2 operations. */
export class SubmissionStorageServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates a storage error safe to translate at a route boundary.
   *
   * @param message - User-safe rejection description.
   * @param statusCode - HTTP-style response status.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "SubmissionStorageServiceError"
    this.statusCode = statusCode
  }
}

/**
 * Normalizes a browser-provided filename for display and persistence.
 *
 * @param filename - Untrusted browser filename.
 * @returns Trimmed base filename without directory segments.
 * @throws SubmissionStorageServiceError when the result is empty or too long.
 */
export function normalizeSubmissionOriginalFilename(filename: string): string {
  const baseFilename = filename.trim().split(/[\\/]/).pop() ?? ""
  const normalizedFilename = baseFilename.replace(/\s+/g, " ")

  if (normalizedFilename.length < 1 || normalizedFilename.length > 240) {
    throw new SubmissionStorageServiceError(
      "Submission filename must be between 1 and 240 characters.",
      400
    )
  }

  return normalizedFilename
}

/**
 * Produces a deterministic ASCII filename safe for use in an R2 object key.
 *
 * @param originalFilename - Valid display filename.
 * @returns Safe filename beginning with an ASCII letter or number.
 */
export function createSafeSubmissionFilename(
  originalFilename: string
): string {
  const normalizedFilename = normalizeSubmissionOriginalFilename(originalFilename)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
  const extensionMatch = normalizedFilename.match(/\.[A-Za-z0-9]{1,10}$/)
  const extension = extensionMatch?.[0] ?? ""
  const stem = extension
    ? normalizedFilename.slice(0, -extension.length)
    : normalizedFilename
  const safeStem = stem
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
  const fallbackStem = safeStem.length > 0 ? safeStem : "upload"
  const boundedStem = fallbackStem.slice(0, 180 - extension.length)

  return `${boundedStem}${extension}`
}

/**
 * Validates a submission upload against the configured MIME whitelist and size cap.
 *
 * @param input - Requested content type and byte size.
 * @param policy - Optional validated policy, primarily for tests.
 * @throws SubmissionStorageServiceError when upload metadata is unsupported.
 */
export function validateSubmissionUploadRequest(
  input: ValidateSubmissionUploadRequestInput,
  policy: FileUploadPolicyEnv = getFileUploadPolicyEnv()
): void {
  const supportedContentTypes: readonly string[] =
    SUBMISSION_FILE_CONTENT_TYPES

  if (
    input.contentType !== input.contentType.trim().toLowerCase() ||
    !supportedContentTypes.includes(input.contentType) ||
    !policy.FILE_UPLOAD_ALLOWED_MIME_TYPES.includes(input.contentType)
  ) {
    throw new SubmissionStorageServiceError(
      "Submission file content type is not allowed.",
      400
    )
  }

  if (!SHA256_PATTERN.test(input.checksumSha256)) {
    throw new SubmissionStorageServiceError(
      "Submission file checksum is invalid.",
      400
    )
  }

  const configuredMaximum = Math.min(
    policy.FILE_UPLOAD_MAX_BYTES,
    SUBMISSION_FILE_MAX_BYTES
  )

  if (
    !Number.isInteger(input.byteSize) ||
    input.byteSize < 1 ||
    input.byteSize > configuredMaximum
  ) {
    throw new SubmissionStorageServiceError(
      "Submission file byte size is outside the allowed range.",
      400
    )
  }
}

/**
 * Requires the browser filename extension to agree with the claimed MIME type.
 *
 * @param filename - Normalized original or safe filename.
 * @param contentType - Allowed submission MIME type.
 * @throws SubmissionStorageServiceError when the extension is missing or mismatched.
 */
export function assertSubmissionFilenameMatchesContentType(
  filename: string,
  contentType: string
): void {
  const normalizedFilename = normalizeSubmissionOriginalFilename(filename)
    .toLowerCase()
  const allowedExtensions = CONTENT_TYPE_EXTENSIONS[contentType]

  if (
    !allowedExtensions ||
    !allowedExtensions.some((extension: string): boolean =>
      normalizedFilename.endsWith(extension)
    )
  ) {
    throw new SubmissionStorageServiceError(
      "Submission filename extension does not match its content type.",
      400
    )
  }
}

/**
 * Builds the canonical create-only object key for a submission file allocation.
 *
 * @param input - Tenant, submission, field, file, and filename identifiers.
 * @returns Canonical private R2 object key.
 * @throws SubmissionStorageServiceError when an identifier is unsafe.
 */
export function buildSubmissionFileObjectKey(
  input: BuildSubmissionFileObjectKeyInput
): string {
  if (
    !UUID_PATTERN.test(input.organizationId) ||
    !UUID_PATTERN.test(input.submissionId) ||
    !UUID_PATTERN.test(input.fileId) ||
    !FIELD_KEY_PATTERN.test(input.fieldKey) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(input.safeFilename)
  ) {
    throw new SubmissionStorageServiceError(
      "Submission file storage identifiers are invalid.",
      400
    )
  }

  return [
    "organizations",
    input.organizationId,
    "submissions",
    input.submissionId,
    "files",
    input.fieldKey,
    input.fileId,
    input.safeFilename,
  ].join("/")
}

/**
 * Creates a signed R2 PUT URL that cannot replace an existing object.
 *
 * @param input - Canonical allocation identifiers and upload metadata.
 * @param deps - Optional R2 and signing dependencies.
 * @returns Signed URL, object key, and expiry.
 * @throws SubmissionStorageServiceError when validation or signing fails.
 */
export async function createSignedSubmissionUploadUrl(
  input: CreateSignedSubmissionUploadUrlInput,
  deps: SubmissionStorageServiceDeps = {}
): Promise<SignedSubmissionUploadUrl> {
  return runSubmissionStorageOperation(
    "create_submission_upload_url",
    {
      organizationId: input.organizationId,
      submissionId: input.submissionId,
      fieldKey: input.fieldKey,
      fileId: input.fileId,
      contentType: input.contentType,
      byteSize: input.byteSize,
    },
    async (): Promise<SignedSubmissionUploadUrl> => {
      const policy = deps.fileUploadPolicy ?? getFileUploadPolicyEnv()
      validateSubmissionUploadRequest(input, policy)
      assertSubmissionFilenameMatchesContentType(
        input.safeFilename,
        input.contentType
      )
      const storageKey = buildSubmissionFileObjectKey(input)
      const r2Env = deps.r2Env ?? getR2Env()
      const r2Client = deps.r2Client ?? createR2Client(r2Env)
      const signer = deps.signer ?? signSubmissionStorageCommand
      const expiresInSeconds = Math.min(
        r2Env.CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS,
        SUBMISSION_UPLOAD_URL_MAX_TTL_SECONDS
      )
      const command = new PutObjectCommand({
        Bucket: r2Env.CLOUDFLARE_R2_BUCKET_NAME,
        Key: storageKey,
        ContentLength: input.byteSize,
        ContentType: input.contentType,
        IfNoneMatch: "*",
      })
      const uploadUrl = await signer(r2Client, command, {
        expiresIn: expiresInSeconds,
        signableHeaders: new Set(["content-type"]),
      })

      return {
        uploadUrl,
        storageKey,
        expiresInSeconds,
      }
    }
  )
}

/**
 * Downloads and verifies that an uploaded object matches its bound allocation.
 *
 * @param input - Expected storage key, content type, and byte size.
 * @param deps - Optional R2 and HEAD dependencies.
 * @returns A promise resolving only after exact metadata verification.
 * @throws SubmissionStorageServiceError for missing or mismatched objects.
 */
export async function verifySubmissionUpload(
  input: VerifySubmissionUploadInput,
  deps: SubmissionStorageServiceDeps = {}
): Promise<void> {
  return runSubmissionStorageOperation(
    "verify_submission_upload",
    {
      storageKey: input.storageKey,
      contentType: input.contentType,
      byteSize: input.byteSize,
    },
    async (): Promise<void> => {
      assertStoredObjectInput(input)
      const r2Env = deps.r2Env ?? getR2Env()
      const r2Client = deps.r2Client ?? createR2Client(r2Env)
      const getObject = deps.getObject ?? getSubmissionStorageObject

      let storedObject: GetObjectCommandOutput

      try {
        storedObject = await getObject(
          r2Client,
          new GetObjectCommand({
            Bucket: r2Env.CLOUDFLARE_R2_BUCKET_NAME,
            Key: input.storageKey,
          })
        )
      } catch (error: unknown) {
        if (isObjectNotFoundError(error)) {
          throw new SubmissionStorageServiceError(
            "Uploaded submission file was not found.",
            409
          )
        }

        throw error
      }

      if (storedObject.ContentLength !== input.byteSize) {
        throw new SubmissionStorageServiceError(
          "Uploaded submission file byte size does not match its allocation.",
          409
        )
      }

      if (storedObject.ContentType !== input.contentType) {
        throw new SubmissionStorageServiceError(
          "Uploaded submission file content type does not match its allocation.",
          409
        )
      }

      const bytes = await readSubmissionObjectBytes(storedObject)

      if (bytes.byteLength !== input.byteSize) {
        throw new SubmissionStorageServiceError(
          "Uploaded submission file bytes do not match its allocation.",
          409
        )
      }

      const checksumSha256 = createHash("sha256").update(bytes).digest("hex")

      if (checksumSha256 !== input.checksumSha256) {
        throw new SubmissionStorageServiceError(
          "Uploaded submission file checksum does not match its allocation.",
          409
        )
      }

      assertSubmissionFileSignature(bytes, input.contentType)
    }
  )
}

/**
 * Deletes a private object after its database allocation is superseded.
 *
 * @param input - Persisted canonical storage key.
 * @param deps - Optional R2 and delete dependencies.
 * @returns A promise that resolves after the idempotent delete request.
 * @throws SubmissionStorageServiceError when the key or provider request fails.
 */
export async function deleteSubmissionStorageObject(
  input: DeleteSubmissionStorageObjectInput,
  deps: SubmissionStorageServiceDeps = {}
): Promise<void> {
  return runSubmissionStorageOperation(
    "delete_superseded_submission_object",
    { storageKey: input.storageKey },
    async (): Promise<void> => {
      if (!isSafePersistedStorageKey(input.storageKey)) {
        throw new SubmissionStorageServiceError(
          "Submission file storage key is invalid.",
          400
        )
      }

      const r2Env = deps.r2Env ?? getR2Env()
      const r2Client = deps.r2Client ?? createR2Client(r2Env)
      const deleteObject =
        deps.deleteObject ?? deleteSubmissionStorageObjectCommand

      await deleteObject(
        r2Client,
        new DeleteObjectCommand({
          Bucket: r2Env.CLOUDFLARE_R2_BUCKET_NAME,
          Key: input.storageKey,
        })
      )
    }
  )
}

/**
 * Creates a signed attachment-only URL for one private submission file.
 *
 * @param input - Persisted object key and safe download filename.
 * @param deps - Optional R2 and signing dependencies.
 * @returns Signed URL and expiry.
 * @throws SubmissionStorageServiceError when validation or signing fails.
 */
export async function createSignedSubmissionDownloadUrl(
  input: CreateSignedSubmissionDownloadUrlInput,
  deps: SubmissionStorageServiceDeps = {}
): Promise<SignedSubmissionDownloadUrl> {
  return runSubmissionStorageOperation(
    "create_submission_download_url",
    { storageKey: input.storageKey },
    async (): Promise<SignedSubmissionDownloadUrl> => {
      if (!isSafePersistedStorageKey(input.storageKey)) {
        throw new SubmissionStorageServiceError(
          "Submission file storage key is invalid.",
          400
        )
      }

      const safeFilename = createSafeSubmissionFilename(input.downloadFilename)
      const r2Env = deps.r2Env ?? getR2Env()
      const r2Client = deps.r2Client ?? createR2Client(r2Env)
      const signer = deps.signer ?? signSubmissionStorageCommand
      const command = new GetObjectCommand({
        Bucket: r2Env.CLOUDFLARE_R2_BUCKET_NAME,
        Key: input.storageKey,
        ResponseContentDisposition: `attachment; filename="${safeFilename}"`,
      })
      const downloadUrl = await signer(r2Client, command, {
        expiresIn: r2Env.CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS,
      })

      return {
        downloadUrl,
        expiresInSeconds: r2Env.CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS,
      }
    }
  )
}

type StorageLogValue = string | number | boolean | null | undefined

async function runSubmissionStorageOperation<T>(
  operationName: string,
  identifiers: Record<string, StorageLogValue>,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now()

  try {
    const result = await operation()
    console.info("submission_storage_success", {
      operationName,
      durationMs: Date.now() - startedAt,
      ...identifiers,
    })
    return result
  } catch (error: unknown) {
    const storageError = toSubmissionStorageError(error)
    const log = storageError.statusCode >= 500 ? console.error : console.warn
    log("submission_storage_rejected", {
      operationName,
      statusCode: storageError.statusCode,
      durationMs: Date.now() - startedAt,
      ...identifiers,
    })
    throw storageError
  }
}

function assertStoredObjectInput(input: VerifySubmissionUploadInput): void {
  if (
    !isSafePersistedStorageKey(input.storageKey) ||
    input.contentType.length === 0 ||
    !Number.isInteger(input.byteSize) ||
    input.byteSize < 1 ||
    input.byteSize > SUBMISSION_FILE_MAX_BYTES ||
    !SHA256_PATTERN.test(input.checksumSha256)
  ) {
    throw new SubmissionStorageServiceError(
      "Submission file verification metadata is invalid.",
      400
    )
  }
}

function isSafePersistedStorageKey(storageKey: string): boolean {
  const segments = storageKey.split("/")

  return (
    segments[0] === "organizations" &&
    UUID_PATTERN.test(segments[1] ?? "") &&
    segments[2] === "submissions" &&
    UUID_PATTERN.test(segments[3] ?? "") &&
    segments[4] === "files" &&
    FIELD_KEY_PATTERN.test(segments[5] ?? "") &&
    UUID_PATTERN.test(segments[6] ?? "") &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(segments[7] ?? "") &&
    segments.length === 8
  )
}

function toSubmissionStorageError(error: unknown): SubmissionStorageServiceError {
  if (error instanceof SubmissionStorageServiceError) {
    return error
  }

  if (error instanceof Error) {
    if (error.message.includes("Invalid R2 environment")) {
      return new SubmissionStorageServiceError(
        "Cloudflare R2 is not configured.",
        500
      )
    }

    if (error.message.includes("Invalid file upload policy environment")) {
      return new SubmissionStorageServiceError(
        "File upload policy is not configured.",
        500
      )
    }
  }

  return new SubmissionStorageServiceError(
    "Submission file storage operation failed.",
    500
  )
}

function isObjectNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false
  }

  const candidate = error as {
    name?: unknown
    code?: unknown
    Code?: unknown
    $metadata?: { httpStatusCode?: unknown }
  }

  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    [candidate.name, candidate.code, candidate.Code].some(
      (code: unknown): boolean =>
        code === "NotFound" ||
        code === "NoSuchKey" ||
        code === "NoSuchObject"
    )
  )
}

async function getSubmissionStorageObject(
  client: S3Client,
  command: GetObjectCommand
): Promise<GetObjectCommandOutput> {
  return client.send(command)
}

async function deleteSubmissionStorageObjectCommand(
  client: S3Client,
  command: DeleteObjectCommand
): Promise<void> {
  await client.send(command)
}

async function signSubmissionStorageCommand(
  client: S3Client,
  command: SubmissionStorageCommand,
  options: {
    expiresIn: number
    signableHeaders?: Set<string>
  }
): Promise<string> {
  return getSignedUrl(client, command, options)
}

async function readSubmissionObjectBytes(
  storedObject: GetObjectCommandOutput
): Promise<Uint8Array> {
  const body = storedObject.Body

  if (!body || typeof body.transformToByteArray !== "function") {
    throw new SubmissionStorageServiceError(
      "Uploaded submission file body could not be verified.",
      500
    )
  }

  const bytes = await body.transformToByteArray()

  if (bytes.byteLength > SUBMISSION_FILE_MAX_BYTES) {
    throw new SubmissionStorageServiceError(
      "Uploaded submission file exceeds the verification limit.",
      409
    )
  }

  return bytes
}

function assertSubmissionFileSignature(
  bytes: Uint8Array,
  contentType: string
): void {
  if (contentType === "application/pdf") {
    const header = new TextDecoder("latin1").decode(bytes.slice(0, 1_024))

    if (!header.includes("%PDF-")) {
      throw invalidStoredFileType()
    }

    return
  }

  if (contentType === "image/png") {
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]

    if (!pngSignature.every((value: number, index: number) => bytes[index] === value)) {
      throw invalidStoredFileType()
    }

    return
  }

  if (contentType === "image/jpeg") {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw invalidStoredFileType()
    }

    return
  }

  if (contentType === "text/csv") {
    assertUtf8Csv(bytes)
    return
  }

  if (
    contentType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    assertOoxmlContainer(bytes, "word/document.xml")
    return
  }

  if (
    contentType ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    assertOoxmlContainer(bytes, "xl/workbook.xml")
    return
  }

  throw invalidStoredFileType()
}

function assertUtf8Csv(bytes: Uint8Array): void {
  let value: string

  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw invalidStoredFileType()
  }

  for (const character of value) {
    const code = character.charCodeAt(0)

    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      throw invalidStoredFileType()
    }
  }
}

function assertOoxmlContainer(
  bytes: Uint8Array,
  requiredDocumentEntry: string
): void {
  const entries = readZipCentralDirectoryEntries(bytes)

  if (
    !entries.has("[Content_Types].xml") ||
    !entries.has(requiredDocumentEntry) ||
    entries.has("word/vbaProject.bin") ||
    entries.has("xl/vbaProject.bin")
  ) {
    throw invalidStoredFileType()
  }
}

function readZipCentralDirectoryEntries(bytes: Uint8Array): ReadonlySet<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const minimumEocdSize = 22
  const searchStart = Math.max(0, bytes.byteLength - 65_557)
  let eocdOffset = -1

  for (
    let offset = bytes.byteLength - minimumEocdSize;
    offset >= searchStart;
    offset -= 1
  ) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocdOffset = offset
      break
    }
  }

  if (eocdOffset < 0) {
    throw invalidStoredFileType()
  }

  const diskNumber = view.getUint16(eocdOffset + 4, true)
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true)
  const entryCount = view.getUint16(eocdOffset + 10, true)
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true)
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true)

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    centralDirectoryOffset + centralDirectorySize > eocdOffset
  ) {
    throw invalidStoredFileType()
  }

  const entries = new Set<string>()
  let offset = centralDirectoryOffset
  let totalUncompressedBytes = 0

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (offset + 46 > eocdOffset || view.getUint32(offset, true) !== 0x02014b50) {
      throw invalidStoredFileType()
    }

    const flags = view.getUint16(offset + 8, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const filenameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const entryEnd = offset + 46 + filenameLength + extraLength + commentLength

    totalUncompressedBytes += uncompressedSize

    if (
      (flags & 0x1) !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      totalUncompressedBytes > MAX_OOXML_UNCOMPRESSED_BYTES ||
      entryEnd > eocdOffset
    ) {
      throw invalidStoredFileType()
    }

    let filename: string

    try {
      filename = new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.slice(offset + 46, offset + 46 + filenameLength)
      )
    } catch {
      throw invalidStoredFileType()
    }

    const normalizedFilename = filename.replace(/\\/g, "/")

    if (
      normalizedFilename.startsWith("/") ||
      normalizedFilename.split("/").includes("..")
    ) {
      throw invalidStoredFileType()
    }

    assertZipLocalEntry({
      bytes,
      centralDirectoryOffset,
      compressedSize,
      expectedFilename: filename,
      localHeaderOffset,
      view,
    })

    entries.add(normalizedFilename)
    offset = entryEnd
  }

  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    throw invalidStoredFileType()
  }

  return entries
}

function assertZipLocalEntry(input: {
  bytes: Uint8Array
  centralDirectoryOffset: number
  compressedSize: number
  expectedFilename: string
  localHeaderOffset: number
  view: DataView
}): void {
  if (
    input.localHeaderOffset + 30 > input.centralDirectoryOffset ||
    input.view.getUint32(input.localHeaderOffset, true) !== 0x04034b50
  ) {
    throw invalidStoredFileType()
  }

  const filenameLength = input.view.getUint16(input.localHeaderOffset + 26, true)
  const extraLength = input.view.getUint16(input.localHeaderOffset + 28, true)
  const dataOffset = input.localHeaderOffset + 30 + filenameLength + extraLength
  const dataEnd = dataOffset + input.compressedSize

  if (dataEnd > input.centralDirectoryOffset) {
    throw invalidStoredFileType()
  }

  let localFilename: string

  try {
    localFilename = new TextDecoder("utf-8", { fatal: true }).decode(
      input.bytes.slice(
        input.localHeaderOffset + 30,
        input.localHeaderOffset + 30 + filenameLength
      )
    )
  } catch {
    throw invalidStoredFileType()
  }

  if (localFilename !== input.expectedFilename) {
    throw invalidStoredFileType()
  }
}

function invalidStoredFileType(): SubmissionStorageServiceError {
  return new SubmissionStorageServiceError(
    "Uploaded submission file bytes do not match an allowed file format.",
    409
  )
}
