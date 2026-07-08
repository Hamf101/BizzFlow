import {
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3"
import { describe, expect, it, vi } from "vitest"

import type { FileUploadPolicyEnv, R2Env } from "@/lib/env"
import {
  buildDocumentObjectKey,
  createSignedDocumentDownloadUrl,
  createSignedDocumentUploadUrl,
  DocumentStorageServiceError,
  type DocumentStorageSigner,
  validateDocumentUploadRequest,
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
      ContentType: "application/pdf",
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
    })
  })
})
