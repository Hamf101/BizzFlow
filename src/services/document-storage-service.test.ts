import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { describe, expect, it, vi } from "vitest"

import type { FileUploadPolicyEnv, R2Env } from "@/lib/env"
import {
  buildDocumentObjectKey,
  createSignedDocumentDownloadUrl,
  createSignedDocumentUploadUrl,
  DocumentStorageServiceError,
  type DocumentStorageHeadObject,
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

const objectKeyInput = {
  organizationId: "org-1",
  documentId: "doc-1",
  versionId: "ver-1",
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
      `organizations/org-1/documents/doc-1/versions/ver-1/original${extension}`
    )
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
  it("cryptographically binds the declared upload length", async () => {
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

    expect(signedHeaders).toContain("content-length")
  })

  it("signs an attachment-only response override for downloads", async () => {
    const result = await createSignedDocumentDownloadUrl(
      {
        storageKey: "organizations/org-1/documents/doc-1/versions/ver-1/original.pdf",
      },
      {
        r2Client: createTestR2Client(),
        r2Env,
      }
    )
    const signedUrl = new URL(result.downloadUrl)

    expect(signedUrl.searchParams.get("response-content-disposition")).toBe(
      "attachment"
    )
  })

  it("uses an injected signer with a PutObjectCommand for uploads", async () => {
    const r2Client = {} as S3Client
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
      }
    )

    const expectedStorageKey =
      "organizations/org-1/documents/doc-1/versions/ver-1/original.pdf"

    expect(result).toEqual({
      uploadUrl: "https://signed.example/upload",
      storageKey: expectedStorageKey,
      expiresInSeconds: 60,
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
    expect(signedOptions).toEqual({ expiresIn: 60 })
  })

  it("uses an injected signer with a GetObjectCommand for downloads", async () => {
    const r2Client = {} as S3Client
    const signer = vi.fn<DocumentStorageSigner>(
      async (): Promise<string> => {
        return "https://signed.example/download"
      }
    )

    const result = await createSignedDocumentDownloadUrl(
      {
        storageKey: "organizations/org-1/documents/doc-1/versions/ver-1/original.pdf",
      },
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
      Key: "organizations/org-1/documents/doc-1/versions/ver-1/original.pdf",
      ResponseContentDisposition: "attachment",
    })
  })
})

function createTestR2Client(): S3Client {
  return new S3Client({
    region: r2Env.CLOUDFLARE_R2_REGION,
    endpoint: r2Env.CLOUDFLARE_R2_ENDPOINT,
    credentials: {
      accessKeyId: r2Env.CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: r2Env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    },
  })
}

describe("document upload verification", () => {
  it("HEADs the object and accepts matching normalized metadata", async () => {
    const r2Client = {} as S3Client
    const headObject = vi.fn<DocumentStorageHeadObject>(
      async () => ({
        ContentLength: 10,
        ContentType: " Application/PDF; charset=binary ",
        $metadata: {},
      })
    )
    const storageKey =
      "organizations/org-1/documents/doc-1/versions/ver-1/original.pdf"

    await expect(
      verifyDocumentUpload(
        {
          storageKey,
          contentType: "application/pdf",
          byteSize: 10,
        },
        {
          r2Client,
          r2Env,
          headObject,
        }
      )
    ).resolves.toBeUndefined()

    expect(headObject).toHaveBeenCalledOnce()
    const headCall = headObject.mock.calls[0]

    if (!headCall) {
      throw new Error("Expected object metadata executor to be called.")
    }

    const [headClient, headCommand] = headCall

    expect(headClient).toBe(r2Client)
    expect(headCommand).toBeInstanceOf(HeadObjectCommand)
    expect(headCommand.input).toEqual({
      Bucket: "documents",
      Key: storageKey,
    })
  })

  it.each([
    [
      { ContentLength: 9, ContentType: "application/pdf", $metadata: {} },
      "Uploaded document byte size does not match the pending version.",
    ],
    [
      { ContentLength: 10, ContentType: "image/png", $metadata: {} },
      "Uploaded document content type does not match the pending version.",
    ],
  ])(
    "rejects uploaded object metadata mismatches",
    async (objectMetadata, expectedMessage: string) => {
      const headObject = vi.fn<DocumentStorageHeadObject>(
        async () => objectMetadata
      )

      await expect(
        verifyDocumentUpload(
          {
            storageKey: "documents/version.pdf",
            contentType: "application/pdf",
            byteSize: 10,
          },
          {
            r2Client: {} as S3Client,
            r2Env,
            headObject,
          }
        )
      ).rejects.toMatchObject({
        message: expectedMessage,
        statusCode: 409,
      } satisfies Partial<DocumentStorageServiceError>)
    }
  )

  it("returns a conflict when the uploaded object is missing", async () => {
    const headObject = vi.fn<DocumentStorageHeadObject>(async () => {
      throw Object.assign(new Error("Object not found"), {
        name: "NotFound",
        $metadata: { httpStatusCode: 404 },
      })
    })

    await expect(
      verifyDocumentUpload(
        {
          storageKey: "documents/missing.pdf",
          contentType: "application/pdf",
          byteSize: 10,
        },
        {
          r2Client: {} as S3Client,
          r2Env,
          headObject,
        }
      )
    ).rejects.toMatchObject({
      message: "Uploaded document object was not found.",
      statusCode: 409,
    } satisfies Partial<DocumentStorageServiceError>)
  })

  it("returns a storage error when the HEAD request fails unexpectedly", async () => {
    const headObject = vi.fn<DocumentStorageHeadObject>(async () => {
      throw new Error("R2 is unavailable")
    })

    await expect(
      verifyDocumentUpload(
        {
          storageKey: "documents/version.pdf",
          contentType: "application/pdf",
          byteSize: 10,
        },
        {
          r2Client: {} as S3Client,
          r2Env,
          headObject,
        }
      )
    ).rejects.toMatchObject({
      message: "Unable to verify uploaded document object.",
      statusCode: 500,
    } satisfies Partial<DocumentStorageServiceError>)
  })

  it("preserves structured validation errors", async () => {
    const headObject = vi.fn<DocumentStorageHeadObject>()

    await expect(
      verifyDocumentUpload(
        {
          storageKey: "  ",
          contentType: "application/pdf",
          byteSize: 10,
        },
        {
          r2Client: {} as S3Client,
          r2Env,
          headObject,
        }
      )
    ).rejects.toMatchObject({
      message: "Document storage key is required.",
      statusCode: 400,
    } satisfies Partial<DocumentStorageServiceError>)
    expect(headObject).not.toHaveBeenCalled()
  })
})
