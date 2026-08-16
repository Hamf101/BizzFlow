import {
  HeadObjectCommand,
  PutObjectCommand,
  type HeadObjectCommandOutput,
  type PutObjectCommandOutput,
  type S3Client,
} from "@aws-sdk/client-s3"

import { getR2Env, type R2Env } from "@/lib/env"
import { createR2Client } from "@/lib/r2/client"

import type {
  FinalizationHeadObject,
  FinalizationPutObject,
  GeneratedDocumentFinalizationStorage,
  StoreGeneratedDocumentFinalPdfInput,
} from "./contracts"
import { GeneratedDocumentFinalizationServiceError } from "./errors"

const PDF_CONTENT_TYPE = "application/pdf"

/** Dependencies used by the production R2 finalization adapter. */
export type R2FinalizationStorageDeps = {
  r2Client?: S3Client
  r2Env?: R2Env
  putObject?: FinalizationPutObject
  headObject?: FinalizationHeadObject
}

/**
 * Creates a private, create-only R2 adapter for finalized PDFs.
 *
 * @param deps - Optional prevalidated R2 client and command executors for tests.
 * @returns Storage port that writes or safely reconciles immutable objects.
 */
export function createR2FinalizationStorage(
  deps: R2FinalizationStorageDeps = {}
): GeneratedDocumentFinalizationStorage {
  return {
    store: (input: StoreGeneratedDocumentFinalPdfInput): Promise<void> =>
      storeFinalPdf(input, deps),
  }
}

async function storeFinalPdf(
  input: StoreGeneratedDocumentFinalPdfInput,
  deps: R2FinalizationStorageDeps
): Promise<void> {
  const startedAt = performance.now()

  try {
    const r2Env = deps.r2Env ?? getR2Env()
    const r2Client = deps.r2Client ?? createR2Client(r2Env)
    const putObject = deps.putObject ?? putR2Object
    const command = new PutObjectCommand({
      Bucket: r2Env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: input.storageKey,
      Body: input.pdf,
      ContentLength: input.pdf.length,
      ContentType: PDF_CONTENT_TYPE,
      IfNoneMatch: "*",
      Metadata: {
        sha256: input.pdfSha256,
      },
    })

    try {
      await putObject(r2Client, command)
    } catch (error: unknown) {
      if (!isConditionalWriteConflict(error)) {
        throw new GeneratedDocumentFinalizationServiceError(
          "Unable to store finalized document PDF.",
          500
        )
      }

      await reconcileExistingObject(input, r2Client, r2Env, deps)
    }

    console.info("generated_document_final_pdf_stored", {
      organizationId: input.organizationId,
      documentId: input.documentId,
      finalizationId: input.finalizationId,
      byteSize: input.pdf.length,
      durationMs: Math.round(performance.now() - startedAt),
    })
  } catch (error: unknown) {
    const normalizedError =
      error instanceof GeneratedDocumentFinalizationServiceError
        ? error
        : new GeneratedDocumentFinalizationServiceError(
            "Unable to store finalized document PDF.",
            500
          )

    console.warn("generated_document_final_pdf_storage_failed", {
      organizationId: input.organizationId,
      documentId: input.documentId,
      finalizationId: input.finalizationId,
      statusCode: normalizedError.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
    })
    throw normalizedError
  }
}

async function reconcileExistingObject(
  input: StoreGeneratedDocumentFinalPdfInput,
  r2Client: S3Client,
  r2Env: R2Env,
  deps: R2FinalizationStorageDeps
): Promise<void> {
  const headObject = deps.headObject ?? headR2Object
  let metadata: HeadObjectCommandOutput

  try {
    metadata = await headObject(
      r2Client,
      new HeadObjectCommand({
        Bucket: r2Env.CLOUDFLARE_R2_BUCKET_NAME,
        Key: input.storageKey,
      })
    )
  } catch {
    throw new GeneratedDocumentFinalizationServiceError(
      "Unable to reconcile finalized document PDF.",
      500
    )
  }

  if (
    metadata.ContentType !== PDF_CONTENT_TYPE ||
    metadata.ContentLength !== input.pdf.length ||
    metadata.Metadata?.sha256 !== input.pdfSha256
  ) {
    throw new GeneratedDocumentFinalizationServiceError(
      "Stored finalized document PDF does not match this render.",
      409
    )
  }
}

function isConditionalWriteConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false
  }

  const candidate = error as {
    name?: unknown
    code?: unknown
    Code?: unknown
    $metadata?: { httpStatusCode?: unknown }
  }
  const codes = [candidate.name, candidate.code, candidate.Code]
  const hasCode = (expected: string): boolean =>
    codes.some((code: unknown): boolean => code === expected)

  return (
    candidate.$metadata?.httpStatusCode === 412 ||
    candidate.$metadata?.httpStatusCode === 409 ||
    hasCode("PreconditionFailed") ||
    hasCode("ConditionalRequestConflict")
  )
}

async function putR2Object(
  client: S3Client,
  command: PutObjectCommand
): Promise<PutObjectCommandOutput> {
  return client.send(command)
}

async function headR2Object(
  client: S3Client,
  command: HeadObjectCommand
): Promise<HeadObjectCommandOutput> {
  return client.send(command)
}
