import {
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3"
import { describe, expect, it, vi } from "vitest"

import type { R2Env } from "@/lib/env"
import type {
  FinalizationHeadObject,
  FinalizationPutObject,
} from "@/services/generated-document-finalization/contracts"
import { GeneratedDocumentFinalizationServiceError } from "@/services/generated-document-finalization/errors"
import { createR2FinalizationStorage } from "@/services/generated-document-finalization/storage"

const PDF = Buffer.from("%PDF-1.7\nprivate-final")
const PDF_SHA256 = "a".repeat(64)
const STORAGE_KEY =
  "organizations/20000000-0000-4000-8000-000000000001/documents/30000000-0000-4000-8000-000000000001/finalizations/40000000-0000-4000-8000-000000000001/final.pdf"

const r2Env: R2Env = {
  CLOUDFLARE_R2_ACCOUNT_ID: "account-id",
  CLOUDFLARE_R2_ACCESS_KEY_ID: "access-key-id",
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: "secret-access-key",
  CLOUDFLARE_R2_BUCKET_NAME: "documents",
  CLOUDFLARE_R2_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
  CLOUDFLARE_R2_REGION: "auto",
  CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS: 60,
}

describe("generated document finalization R2 storage", () => {
  it("writes a private PDF once with exact immutable request metadata", async () => {
    const r2Client = {} as S3Client
    const putObject = vi.fn<FinalizationPutObject>(async () => ({
      $metadata: {},
    }))
    const headObject = vi.fn<FinalizationHeadObject>()
    const storage = createR2FinalizationStorage({
      r2Client,
      r2Env,
      putObject,
      headObject,
    })

    await storage.store(createStoreInput())

    expect(putObject).toHaveBeenCalledOnce()
    expect(headObject).not.toHaveBeenCalled()
    const command = putObject.mock.calls[0]?.[1]

    expect(command).toBeInstanceOf(PutObjectCommand)
    expect(command?.input).toEqual({
      Bucket: "documents",
      Key: STORAGE_KEY,
      Body: PDF,
      ContentLength: PDF.length,
      ContentType: "application/pdf",
      IfNoneMatch: "*",
      Metadata: { sha256: PDF_SHA256 },
    })
  })

  it.each([
    ["412 PreconditionFailed", { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } }],
    ["status-only 409 conflict", { $metadata: { httpStatusCode: 409 } }],
  ])("reconciles a matching object after %s", async (_label, providerError) => {
    const putObject = vi.fn<FinalizationPutObject>(async () => {
      throw providerError
    })
    const headObject = vi.fn<FinalizationHeadObject>(async () => ({
      $metadata: {},
      ContentType: "application/pdf",
      ContentLength: PDF.length,
      Metadata: { sha256: PDF_SHA256 },
    }))
    const storage = createR2FinalizationStorage({
      r2Client: {} as S3Client,
      r2Env,
      putObject,
      headObject,
    })

    await expect(storage.store(createStoreInput())).resolves.toBeUndefined()
    expect(headObject).toHaveBeenCalledOnce()
    expect(headObject.mock.calls[0]?.[1]).toBeInstanceOf(HeadObjectCommand)
  })

  it.each([
    ["content type", { ContentType: "Application/PDF", ContentLength: PDF.length, Metadata: { sha256: PDF_SHA256 } }],
    ["byte length", { ContentType: "application/pdf", ContentLength: PDF.length + 1, Metadata: { sha256: PDF_SHA256 } }],
    ["sha256", { ContentType: "application/pdf", ContentLength: PDF.length, Metadata: { sha256: "b".repeat(64) } }],
  ])("fails closed when reconciled %s metadata differs", async (_label, metadata) => {
    const storage = createR2FinalizationStorage({
      r2Client: {} as S3Client,
      r2Env,
      putObject: async () => {
        throw { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } }
      },
      headObject: async () => ({ $metadata: {}, ...metadata }),
    })

    await expect(storage.store(createStoreInput())).rejects.toMatchObject({
      message: "Stored finalized document PDF does not match this render.",
      statusCode: 409,
    })
  })

  it("sanitizes provider failures without logging the raw error", async () => {
    const providerSecret = "https://secret-provider.example/signed?token=private"
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const storage = createR2FinalizationStorage({
      r2Client: {} as S3Client,
      r2Env,
      putObject: async () => {
        throw new Error(providerSecret)
      },
    })

    await expect(storage.store(createStoreInput())).rejects.toEqual(
      new GeneratedDocumentFinalizationServiceError(
        "Unable to store finalized document PDF.",
        500
      )
    )
    expect(JSON.stringify(warning.mock.calls)).not.toContain(providerSecret)
    warning.mockRestore()
  })
})

function createStoreInput() {
  return {
    organizationId: "20000000-0000-4000-8000-000000000001",
    documentId: "30000000-0000-4000-8000-000000000001",
    finalizationId: "40000000-0000-4000-8000-000000000001",
    storageKey: STORAGE_KEY,
    pdf: PDF,
    pdfSha256: PDF_SHA256,
  }
}
