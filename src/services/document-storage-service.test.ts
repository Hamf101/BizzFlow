import { createHash } from "node:crypto"

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3"
import { describe, expect, it, vi } from "vitest"

import type { FileUploadPolicyEnv, R2Env } from "@/lib/env"
import { createR2Client } from "@/lib/r2/client"
import {
  buildDocumentObjectKey,
  createSignedDocumentDownloadUrl,
  createSignedDocumentUploadUrl,
  deleteDocumentStorageObject,
  DocumentStorageServiceError,
  type DocumentStorageDeleteObject,
  type DocumentStorageGetObject,
  type DocumentStorageSigner,
  validateDocumentUploadRequest,
  verifyDocumentUpload,
} from "@/services/document-storage-service"

const r2Env: R2Env = {
  CLOUDFLARE_R2_ACCOUNT_ID: "account-id",
  CLOUDFLARE_R2_ACCESS_KEY_ID: "access-key-id",
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: "secret-access-key",
  CLOUDFLARE_R2_BUCKET_NAME: "documents",
  CLOUDFLARE_R2_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
  CLOUDFLARE_R2_REGION: "auto",
  CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS: 60,
}

const fileUploadPolicy: FileUploadPolicyEnv = {
  FILE_UPLOAD_MAX_BYTES: 100,
  FILE_UPLOAD_ALLOWED_MIME_TYPES: [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
  ],
}

const ORG_ID = "10000000-0000-4000-8000-000000000001"
const DOCUMENT_ID = "30000000-0000-4000-8000-000000000001"
const VERSION_ID = "50000000-0000-4000-8000-000000000001"
const STORAGE_KEY = `organizations/${ORG_ID}/documents/${DOCUMENT_ID}/versions/${VERSION_ID}/original.pdf`
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF")

const objectKeyInput = {
  organizationId: ORG_ID,
  documentId: DOCUMENT_ID,
  versionId: VERSION_ID,
}

describe("document object keys", () => {
  it.each([
    ["application/pdf", ".pdf"],
    ["image/png", ".png"],
    ["image/jpeg", ".jpg"],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".docx",
    ],
    [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".xlsx",
    ],
    ["text/csv", ".csv"],
  ])("builds deterministic keys for %s", (contentType: string, extension: string) => {
    expect(
      buildDocumentObjectKey({
        ...objectKeyInput,
        contentType,
      })
    ).toBe(
      `organizations/${ORG_ID}/documents/${DOCUMENT_ID}/versions/${VERSION_ID}/original${extension}`
    )
  })

  it("refuses an id that is not a UUID, so a key cannot reach outside its document", () => {
    expect(() =>
      buildDocumentObjectKey({
        ...objectKeyInput,
        documentId: "../../other-org",
        contentType: "application/pdf",
      })
    ).toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it("rejects unsupported content types", () => {
    expect(() =>
      buildDocumentObjectKey({
        ...objectKeyInput,
        contentType: "text/plain",
      })
    ).toThrow(DocumentStorageServiceError)
  })
})

describe("document upload validation", () => {
  it("rejects content types that are not allowed by policy", () => {
    expect(() => {
      validateDocumentUploadRequest(
        {
          contentType: "image/gif",
          byteSize: 10,
        },
        fileUploadPolicy
      )
    }).toThrow(DocumentStorageServiceError)

    try {
      validateDocumentUploadRequest(
        {
          contentType: "image/gif",
          byteSize: 10,
        },
        fileUploadPolicy
      )
    } catch (error: unknown) {
      expect(error).toMatchObject({
        message: "Document content type is not allowed.",
        statusCode: 400,
      } satisfies Partial<DocumentStorageServiceError>)
    }
  })

  it.each([0, 101])("rejects byte size %s", (byteSize: number) => {
    expect(() => {
      validateDocumentUploadRequest(
        {
          contentType: "application/pdf",
          byteSize,
        },
        fileUploadPolicy
      )
    }).toThrow(DocumentStorageServiceError)

    try {
      validateDocumentUploadRequest(
        {
          contentType: "application/pdf",
          byteSize,
        },
        fileUploadPolicy
      )
    } catch (error: unknown) {
      expect(error).toMatchObject({
        message: "Document byte size is outside the allowed range.",
        statusCode: 400,
      } satisfies Partial<DocumentStorageServiceError>)
    }
  })
})

describe("document signed URL helpers", () => {
  it("signs required upload headers without synthetic checksum parameters", async () => {
    const r2Client = createTestR2Client()

    const result = await createSignedDocumentUploadUrl(
      {
        ...objectKeyInput,
        contentType: "application/pdf",
        byteSize: 10,
      },
      {
        r2Client,
        r2Env,
        fileUploadPolicy,
      }
    )
    const signedUrl = new URL(result.uploadUrl)
    const signedHeaders =
      signedUrl.searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? []

    expect(signedHeaders).toEqual(
      expect.arrayContaining([
        "content-length",
        "content-type",
        "if-none-match",
      ])
    )
    expect(signedUrl.searchParams.has("x-amz-checksum-crc32")).toBe(false)
    expect(
      signedUrl.searchParams.has("x-amz-sdk-checksum-algorithm")
    ).toBe(false)
  })

  it("signs an attachment-only response override for downloads", async () => {
    const result = await createSignedDocumentDownloadUrl(
      { downloadFilename: "contract.pdf", storageKey: STORAGE_KEY },
      {
        r2Client: createTestR2Client(),
        r2Env,
      }
    )
    const signedUrl = new URL(result.downloadUrl)

    expect(signedUrl.searchParams.get("response-content-disposition")).toBe(
      'attachment; filename="contract.pdf"'
    )
  })

  it("signs an inline response of the stored type for viewing", async () => {
    const result = await createSignedDocumentDownloadUrl(
      { downloadFilename: "contract.pdf", storageKey: STORAGE_KEY, viewAs: "application/pdf" },
      { r2Client: createTestR2Client(), r2Env }
    )
    const signedUrl = new URL(result.downloadUrl)

    expect(signedUrl.searchParams.get("response-content-disposition")).toBe("inline")
    expect(signedUrl.searchParams.get("response-content-type")).toBe("application/pdf")
  })

  it("uses an injected signer with a PutObjectCommand for uploads", async () => {
    const r2Client = {} as S3Client
    const signingDate = new Date("2026-08-03T16:00:00.000Z")
    const signer = vi.fn<DocumentStorageSigner>(
      async (): Promise<string> => {
        return "https://signed.example/upload"
      }
    )

    const result = await createSignedDocumentUploadUrl(
      {
        ...objectKeyInput,
        contentType: "application/pdf",
        byteSize: 10,
      },
      {
        r2Client,
        r2Env,
        fileUploadPolicy,
        signer,
        now: (): Date => signingDate,
      }
    )

    const expectedStorageKey =
      STORAGE_KEY

    expect(result).toEqual({
      uploadUrl: "https://signed.example/upload",
      storageKey: expectedStorageKey,
      expiresInSeconds: 60,
      expiresAt: "2026-08-03T16:01:00.000Z",
    })
    expect(signer).toHaveBeenCalledOnce()
    const signerCall = signer.mock.calls[0]

    if (!signerCall) {
      throw new Error("Expected upload signer to be called.")
    }

    const [signedClient, signedCommand, signedOptions] = signerCall

    expect(signedClient).toBe(r2Client)
    expect(signedCommand).toBeInstanceOf(PutObjectCommand)
    if (!(signedCommand instanceof PutObjectCommand)) {
      throw new Error("Expected upload signer to receive PutObjectCommand.")
    }
    expect(signedCommand.input).toEqual({
      Bucket: "documents",
      Key: expectedStorageKey,
      ContentLength: 10,
      ContentType: "application/pdf",
      IfNoneMatch: "*",
    })
    expect(signedOptions).toEqual({
      expiresIn: 60,
      signableHeaders: new Set(["content-type"]),
      signingDate,
    })
  })

  it("uses an injected signer with a GetObjectCommand for downloads", async () => {
    const r2Client = {} as S3Client
    const signer = vi.fn<DocumentStorageSigner>(
      async (): Promise<string> => {
        return "https://signed.example/download"
      }
    )

    const result = await createSignedDocumentDownloadUrl(
      { downloadFilename: "contract.pdf", storageKey: STORAGE_KEY },
      {
        r2Client,
        r2Env,
        fileUploadPolicy,
        signer,
      }
    )

    expect(result).toEqual({
      downloadUrl: "https://signed.example/download",
      expiresInSeconds: 60,
    })
    expect(signer).toHaveBeenCalledOnce()
    const signerCall = signer.mock.calls[0]

    if (!signerCall) {
      throw new Error("Expected download signer to be called.")
    }

    const [signedClient, signedCommand] = signerCall

    expect(signedClient).toBe(r2Client)
    expect(signedCommand).toBeInstanceOf(GetObjectCommand)
    if (!(signedCommand instanceof GetObjectCommand)) {
      throw new Error("Expected download signer to receive GetObjectCommand.")
    }
    expect(signedCommand.input).toEqual({
      Bucket: "documents",
      Key: STORAGE_KEY,
      ResponseContentDisposition: 'attachment; filename="contract.pdf"',
    })
  })
})

describe("document signed URL limits", () => {
  it("caps both links at fifteen minutes, names a download safely, and signs only a stored key", async () => {
    const longLived = { ...r2Env, CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS: 604_800 }
    const signer = vi.fn<DocumentStorageSigner>(async () => "https://signed.example/url")
    const deps = { r2Client: {} as S3Client, r2Env: longLived, fileUploadPolicy, signer }

    const upload = await createSignedDocumentUploadUrl({ ...objectKeyInput, contentType: "application/pdf", byteSize: 10 }, deps)
    const download = await createSignedDocumentDownloadUrl(
      { downloadFilename: 'Q3 "final"\r\nSet-Cookie: x.pdf', storageKey: STORAGE_KEY },
      deps
    )

    expect([upload.expiresInSeconds, download.expiresInSeconds]).toEqual([900, 900])
    expect(signer.mock.calls.map((call) => call[2].expiresIn)).toEqual([900, 900])
    expect((signer.mock.calls[1]?.[1] as GetObjectCommand).input.ResponseContentDisposition).toBe(
      'attachment; filename="Q3-final-Set-Cookie-x.pdf"'
    )

    await expect(
      createSignedDocumentDownloadUrl(
        { downloadFilename: "x.pdf", storageKey: `organizations/${ORG_ID}/submissions/${DOCUMENT_ID}/files/a/${VERSION_ID}/x.pdf` },
        deps
      )
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(signer).toHaveBeenCalledTimes(2)
  })
})

function createTestR2Client(): S3Client {
  return createR2Client(r2Env)
}

describe("document upload verification", () => {
  it("reads the stored bytes back and returns their checksum when they are what was claimed", async () => {
    const getObject = createGetObject(PDF_BYTES, " Application/PDF; charset=binary ")

    await expect(
      verifyDocumentUpload(
        { storageKey: STORAGE_KEY, contentType: "application/pdf", byteSize: PDF_BYTES.byteLength },
        { r2Client: {} as S3Client, r2Env, getObject }
      )
    ).resolves.toBe(createHash("sha256").update(PDF_BYTES).digest("hex"))
    expect(getObject.mock.calls[0]?.[1].input).toEqual({ Bucket: "documents", Key: STORAGE_KEY })
  })

  it("refuses a program renamed as a PDF, though its size and type headers match", async () => {
    const executable = new TextEncoder().encode("MZ fake executable payload")

    await expect(
      verifyDocumentUpload(
        { storageKey: STORAGE_KEY, contentType: "application/pdf", byteSize: executable.byteLength },
        { r2Client: {} as S3Client, r2Env, getObject: createGetObject(executable, "application/pdf") }
      )
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it.each([
    [{ ContentLength: 9 }, "Uploaded document byte size does not match the pending version."],
    [{ ContentType: "image/png" }, "Uploaded document content type does not match the pending version."],
  ])("rejects uploaded object metadata mismatches", async (metadata, expectedMessage: string) => {
    const getObject = createGetObject(PDF_BYTES, "application/pdf", metadata)

    await expect(
      verifyDocumentUpload(
        { storageKey: STORAGE_KEY, contentType: "application/pdf", byteSize: PDF_BYTES.byteLength },
        { r2Client: {} as S3Client, r2Env, getObject }
      )
    ).rejects.toMatchObject({ message: expectedMessage, statusCode: 409 })
  })

  it("returns a conflict when the uploaded object is missing", async () => {
    const getObject = vi.fn<DocumentStorageGetObject>(async () => {
      throw Object.assign(new Error("Object not found"), {
        name: "NotFound",
        $metadata: { httpStatusCode: 404 },
      })
    })

    await expect(
      verifyDocumentUpload(
        { storageKey: STORAGE_KEY, contentType: "application/pdf", byteSize: 10 },
        { r2Client: {} as S3Client, r2Env, getObject }
      )
    ).rejects.toMatchObject({
      message: "Uploaded document object was not found.",
      statusCode: 409,
    } satisfies Partial<DocumentStorageServiceError>)
  })

  it("returns a storage error when the read fails unexpectedly, without logging provider detail", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation((): void => undefined)
    const getObject = vi.fn<DocumentStorageGetObject>(async () => {
      throw Object.assign(new Error("sensitive provider response"), {
        providerRequest: { authorization: "sensitive credential" },
      })
    })

    try {
      await expect(
        verifyDocumentUpload(
          { storageKey: STORAGE_KEY, contentType: "application/pdf", byteSize: 10 },
          { r2Client: {} as S3Client, r2Env, getObject }
        )
      ).rejects.toMatchObject({
        message: "Unable to verify uploaded document object.",
        statusCode: 500,
      } satisfies Partial<DocumentStorageServiceError>)
      expect(consoleError).toHaveBeenCalledWith("document_upload_verification_failed", { durationMs: expect.any(Number) })
    } finally {
      consoleError.mockRestore()
    }
  })

  it("refuses a key that is not a stored document key before reading anything", async () => {
    const getObject = vi.fn<DocumentStorageGetObject>()

    await expect(
      verifyDocumentUpload(
        { storageKey: "documents/version.pdf", contentType: "application/pdf", byteSize: 10 },
        { r2Client: {} as S3Client, r2Env, getObject }
      )
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(getObject).not.toHaveBeenCalled()
  })
})

function createGetObject(
  bytes: Uint8Array,
  contentType: string,
  metadata: { ContentLength?: number; ContentType?: string } = {}
) {
  return vi.fn<DocumentStorageGetObject>(async () =>
    ({
      Body: { transformToByteArray: async (): Promise<Uint8Array> => bytes },
      ContentLength: bytes.byteLength,
      ContentType: contentType,
      $metadata: {},
      ...metadata,
    }) as unknown as GetObjectCommandOutput
  )
}

describe("document object deletion", () => {
  it("deletes the exact persisted object with an idempotent R2 command", async () => {
    const r2Client = {} as S3Client
    const deleteObject = vi.fn<DocumentStorageDeleteObject>(
      async (): Promise<void> => undefined
    )
    const storageKey =
      STORAGE_KEY

    await expect(
      deleteDocumentStorageObject(
        { storageKey },
        { r2Client, r2Env, deleteObject }
      )
    ).resolves.toBeUndefined()

    expect(deleteObject).toHaveBeenCalledOnce()
    const deleteCall = deleteObject.mock.calls[0]

    if (!deleteCall) {
      throw new Error("Expected document object delete executor to be called.")
    }

    const [deleteClient, deleteCommand] = deleteCall

    expect(deleteClient).toBe(r2Client)
    expect(deleteCommand).toBeInstanceOf(DeleteObjectCommand)
    expect(deleteCommand.input).toEqual({
      Bucket: "documents",
      Key: storageKey,
    })
  })

  it("treats a missing object as an idempotent deletion success", async () => {
    const deleteObject = vi.fn<DocumentStorageDeleteObject>(async () => {
      throw Object.assign(new Error("Object not found"), {
        name: "NoSuchKey",
        $metadata: { httpStatusCode: 404 },
      })
    })

    await expect(
      deleteDocumentStorageObject(
        { storageKey: "organizations/org-1/documents/missing.pdf" },
        {
          r2Client: {} as S3Client,
          r2Env,
          deleteObject,
        }
      )
    ).resolves.toBeUndefined()
  })

  it("never includes the raw object key in deletion logs or errors", async () => {
    const rawStorageKey =
      "organizations/org-secret/documents/doc-secret/private.pdf"
    const deleteObject = vi.fn<DocumentStorageDeleteObject>(async () => {
      throw new Error(`provider failure for ${rawStorageKey}`)
    })
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      deleteDocumentStorageObject(
        { storageKey: rawStorageKey },
        {
          r2Client: {} as S3Client,
          r2Env,
          deleteObject,
        }
      )
    ).rejects.toMatchObject({
      message: "Unable to delete document storage object.",
      statusCode: 500,
    } satisfies Partial<DocumentStorageServiceError>)

    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(rawStorageKey)
  })
})
