import { createHash } from "node:crypto"

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type GetObjectCommandOutput,
  type S3Client,
} from "@aws-sdk/client-s3"
import { describe, expect, it, vi } from "vitest"

import type { FileUploadPolicyEnv, R2Env } from "@/lib/env"
import {
  assertSubmissionFilenameMatchesContentType,
  buildSubmissionFileObjectKey,
  createSafeSubmissionFilename,
  createSignedSubmissionDownloadUrl,
  createSignedSubmissionUploadUrl,
  deleteSubmissionStorageObject,
  type SubmissionStorageDeleteObject,
  type SubmissionStorageGetObject,
  SubmissionStorageServiceError,
  type SubmissionStorageSigner,
  validateSubmissionUploadRequest,
  verifySubmissionUpload,
} from "@/services/submission-storage-service"

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001"
const SUBMISSION_ID = "20000000-0000-4000-8000-000000000001"
const FILE_ID = "30000000-0000-4000-8000-000000000001"
const CHECKSUM = "a".repeat(64)
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nverified submission\n%%EOF")
const STORAGE_KEY =
  `organizations/${ORGANIZATION_ID}/submissions/${SUBMISSION_ID}` +
  `/files/evidence/${FILE_ID}/evidence.pdf`

const r2Env: R2Env = {
  CLOUDFLARE_R2_ACCOUNT_ID: "account-id",
  CLOUDFLARE_R2_ACCESS_KEY_ID: "access-key",
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: "secret-key",
  CLOUDFLARE_R2_BUCKET_NAME: "documents",
  CLOUDFLARE_R2_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
  CLOUDFLARE_R2_REGION: "auto",
  CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS: 300,
}

const uploadPolicy: FileUploadPolicyEnv = {
  FILE_UPLOAD_MAX_BYTES: 25 * 1024 * 1024,
  FILE_UPLOAD_ALLOWED_MIME_TYPES: ["application/pdf", "image/png"],
}

describe("submission file storage metadata", () => {
  it("builds the canonical tenant and field-scoped object key", () => {
    expect(
      buildSubmissionFileObjectKey({
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        fieldKey: "supporting_evidence",
        fileId: FILE_ID,
        safeFilename: "evidence.pdf",
      })
    ).toBe(
      `organizations/${ORGANIZATION_ID}/submissions/${SUBMISSION_ID}/files/supporting_evidence/${FILE_ID}/evidence.pdf`
    )
  })

  it("removes unsafe segments while preserving long validated extensions", () => {
    expect(createSafeSubmissionFilename(" ../résumé final (1).pdf ")).toBe(
      "resume-final-1-.pdf"
    )
    const longFilename = createSafeSubmissionFilename(`${"a".repeat(230)}.docx`)

    expect(longFilename).toHaveLength(180)
    expect(longFilename).toMatch(/\.docx$/)
  })

  it("enforces the allowlist, checksum, size, and extension contract", () => {
    expect(() =>
      validateSubmissionUploadRequest(
        {
          contentType: "image/jpeg",
          byteSize: 10,
          checksumSha256: CHECKSUM,
        },
        uploadPolicy
      )
    ).toThrow(SubmissionStorageServiceError)
    expect(() =>
      validateSubmissionUploadRequest(
        {
          contentType: "application/pdf",
          byteSize: 20 * 1024 * 1024 + 1,
          checksumSha256: CHECKSUM,
        },
        uploadPolicy
      )
    ).toThrow(SubmissionStorageServiceError)
    expect(() =>
      validateSubmissionUploadRequest(
        {
          contentType: "application/pdf",
          byteSize: 10,
          checksumSha256: "not-a-checksum",
        },
        uploadPolicy
      )
    ).toThrow("Submission file checksum is invalid.")
    expect(() =>
      assertSubmissionFilenameMatchesContentType(
        "payload.exe",
        "application/pdf"
      )
    ).toThrow("filename extension")
  })
})

describe("submission signed storage requests", () => {
  it("signs a create-only PUT with exact content metadata", async () => {
    const client = {} as S3Client
    const signer = vi.fn<SubmissionStorageSigner>(async () =>
      Promise.resolve("https://signed.example/upload")
    )
    const result = await createSignedSubmissionUploadUrl(
      {
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        fieldKey: "evidence",
        fileId: FILE_ID,
        safeFilename: "evidence.pdf",
        contentType: "application/pdf",
        byteSize: 1_024,
        checksumSha256: CHECKSUM,
      },
      { r2Client: client, r2Env, fileUploadPolicy: uploadPolicy, signer }
    )

    expect(result).toEqual({
      uploadUrl: "https://signed.example/upload",
      storageKey: STORAGE_KEY,
      expiresInSeconds: 300,
    })
    const command = signer.mock.calls[0]?.[1]

    expect(command).toBeInstanceOf(PutObjectCommand)

    if (!(command instanceof PutObjectCommand)) {
      throw new Error("Expected a PutObjectCommand.")
    }

    expect(command.input).toMatchObject({
      Bucket: "documents",
      ContentLength: 1_024,
      ContentType: "application/pdf",
      IfNoneMatch: "*",
    })
    expect(signer.mock.calls[0]?.[2]).toEqual({
      expiresIn: 300,
      signableHeaders: new Set(["content-type"]),
    })
  })

  it("caps upload capabilities at fifteen minutes", async () => {
    const signer = vi.fn<SubmissionStorageSigner>(async () =>
      Promise.resolve("https://signed.example/upload")
    )
    const result = await createSignedSubmissionUploadUrl(
      {
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        fieldKey: "evidence",
        fileId: FILE_ID,
        safeFilename: "evidence.pdf",
        contentType: "application/pdf",
        byteSize: 1_024,
        checksumSha256: CHECKSUM,
      },
      {
        r2Client: {} as S3Client,
        r2Env: {
          ...r2Env,
          CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS: 604_800,
        },
        fileUploadPolicy: uploadPolicy,
        signer,
      }
    )

    expect(result.expiresInSeconds).toBe(900)
    expect(signer.mock.calls[0]?.[2].expiresIn).toBe(900)
  })

  it("uses an attachment response for private downloads", async () => {
    const signer = vi.fn<SubmissionStorageSigner>(async () =>
      Promise.resolve("https://signed.example/download")
    )
    const result = await createSignedSubmissionDownloadUrl(
      {
        storageKey: STORAGE_KEY,
        downloadFilename: "Evidence final.pdf",
      },
      { r2Client: {} as S3Client, r2Env, signer }
    )
    const command = signer.mock.calls[0]?.[1]

    expect(result).toEqual({
      downloadUrl: "https://signed.example/download",
      expiresInSeconds: 300,
    })
    expect(command).toBeInstanceOf(GetObjectCommand)

    if (!(command instanceof GetObjectCommand)) {
      throw new Error("Expected a GetObjectCommand.")
    }

    expect(command.input.ResponseContentDisposition).toBe(
      'attachment; filename="Evidence-final.pdf"'
    )
  })

  it("deletes only a canonical superseded object key", async () => {
    const deleteObject = vi.fn<SubmissionStorageDeleteObject>(async () => undefined)

    await deleteSubmissionStorageObject(
      { storageKey: STORAGE_KEY },
      { r2Client: {} as S3Client, r2Env, deleteObject }
    )

    expect(deleteObject.mock.calls[0]?.[1]).toBeInstanceOf(DeleteObjectCommand)
  })
})

describe("submission upload byte verification", () => {
  it("accepts exact metadata, checksum, and PDF bytes", async () => {
    const getObject = createGetObject(PDF_BYTES, "application/pdf")

    await expect(
      verifySubmissionUpload(
        createVerifyInput(PDF_BYTES, "application/pdf"),
        { r2Client: {} as S3Client, r2Env, getObject }
      )
    ).resolves.toBeUndefined()
    expect(getObject.mock.calls[0]?.[1]).toBeInstanceOf(GetObjectCommand)
  })

  it.each([
    [PDF_BYTES.byteLength - 1, "application/pdf", "byte size"],
    [PDF_BYTES.byteLength, "Application/PDF", "content type"],
  ])(
    "rejects mismatched provider metadata",
    async (contentLength: number, contentType: string, message: string) => {
      const getObject = createGetObject(PDF_BYTES, contentType, contentLength)

      await expect(
        verifySubmissionUpload(
          createVerifyInput(PDF_BYTES, "application/pdf"),
          { r2Client: {} as S3Client, r2Env, getObject }
        )
      ).rejects.toMatchObject({
        message: expect.stringContaining(message),
        statusCode: 409,
      })
    }
  )

  it("rejects stale bytes whose digest differs from the allocation", async () => {
    const staleBytes = new TextEncoder().encode("%PDF-1.7\nstale\n%%EOF")
    const getObject = createGetObject(staleBytes, "application/pdf")

    await expect(
      verifySubmissionUpload(
        {
          ...createVerifyInput(staleBytes, "application/pdf"),
          checksumSha256: sha256(PDF_BYTES),
        },
        { r2Client: {} as S3Client, r2Env, getObject }
      )
    ).rejects.toThrow("checksum does not match")
  })

  it("rejects executable bytes disguised with PDF metadata", async () => {
    const executableBytes = new TextEncoder().encode("MZfake executable")
    const getObject = createGetObject(executableBytes, "application/pdf")

    await expect(
      verifySubmissionUpload(
        createVerifyInput(executableBytes, "application/pdf"),
        { r2Client: {} as S3Client, r2Env, getObject }
      )
    ).rejects.toThrow("allowed file format")
  })

  it("requires the correct macro-free OOXML container", async () => {
    const docxBytes = createStoredZip([
      "[Content_Types].xml",
      "word/document.xml",
    ])
    const xlsxOnlyBytes = createStoredZip([
      "[Content_Types].xml",
      "xl/workbook.xml",
    ])
    const docxType =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    await expect(
      verifySubmissionUpload(createVerifyInput(docxBytes, docxType), {
        r2Client: {} as S3Client,
        r2Env,
        getObject: createGetObject(docxBytes, docxType),
      })
    ).resolves.toBeUndefined()
    await expect(
      verifySubmissionUpload(createVerifyInput(xlsxOnlyBytes, docxType), {
        r2Client: {} as S3Client,
        r2Env,
        getObject: createGetObject(xlsxOnlyBytes, docxType),
      })
    ).rejects.toThrow("allowed file format")
  })

  it("maps a missing provider object to a conflict", async () => {
    const getObject = vi.fn<SubmissionStorageGetObject>(async () => {
      throw Object.assign(new Error("provider detail"), {
        name: "NotFound",
        $metadata: { httpStatusCode: 404 },
      })
    })

    await expect(
      verifySubmissionUpload(createVerifyInput(PDF_BYTES, "application/pdf"), {
        r2Client: {} as S3Client,
        r2Env,
        getObject,
      })
    ).rejects.toMatchObject({
      message: "Uploaded submission file was not found.",
      statusCode: 409,
    })
  })
})

function createGetObject(
  bytes: Uint8Array,
  contentType: string,
  contentLength: number = bytes.byteLength
): ReturnType<typeof vi.fn<SubmissionStorageGetObject>> {
  return vi.fn<SubmissionStorageGetObject>(async () =>
    Promise.resolve({
      Body: {
        transformToByteArray: async (): Promise<Uint8Array> => bytes,
      },
      ContentLength: contentLength,
      ContentType: contentType,
      $metadata: {},
    } as unknown as GetObjectCommandOutput)
  )
}

function createVerifyInput(bytes: Uint8Array, contentType: string) {
  return {
    storageKey: STORAGE_KEY,
    contentType,
    byteSize: bytes.byteLength,
    checksumSha256: sha256(bytes),
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function createStoredZip(entryNames: readonly string[]): Uint8Array {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0

  for (const entryName of entryNames) {
    const filename = Buffer.from(entryName, "utf8")
    const localHeader = Buffer.alloc(30 + filename.length)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(filename.length, 26)
    filename.copy(localHeader, 30)
    localParts.push(localHeader)

    const centralHeader = Buffer.alloc(46 + filename.length)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(filename.length, 28)
    centralHeader.writeUInt32LE(localOffset, 42)
    filename.copy(centralHeader, 46)
    centralParts.push(centralHeader)
    localOffset += localHeader.length
  }

  const localData = Buffer.concat(localParts)
  const centralDirectory = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entryNames.length, 8)
  eocd.writeUInt16LE(entryNames.length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(localData.length, 16)

  return Buffer.concat([localData, centralDirectory, eocd])
}
