import { GetObjectCommand } from "@aws-sdk/client-s3"
import { PDFDocument } from "pdf-lib"

import { getR2Env } from "@/lib/env"
import { createR2Client } from "@/lib/r2/client"
import { hasAllowedFileSignature } from "@/lib/r2/stored-file"
import type { AiAttachment } from "@/services/ai/contracts"
import { normalizeAnswerPatch, collectFields } from "@/services/document-signing/answer-validation"
import { requireDocumentAccess, requireDocumentAccessAs } from "@/services/documents/access-service"
import { getDocumentById } from "@/services/documents/shared"
import { getDocumentVersionById } from "@/services/documents/version-shared"
import {
  type FlowApplicationResult,
  type FlowSourceInput,
  type TemplateFlowClient,
  TemplateFlowServiceError,
} from "@/services/template-flow/contracts"
import type { DocumentVersion } from "@/types/document"

export const FLOW_SOURCE_MAX_BYTES = 15 * 1024 * 1024

export const FLOW_SOURCE_MAX_PDF_PAGES = 10

const SOURCE_KINDS: Readonly<Record<string, AiAttachment["kind"]>> = {
  "application/pdf": "document",
  "image/png": "image",
  "image/jpeg": "image",
}

export type FlowSourceDeps = {
  client: TemplateFlowClient
  /** Reads a stored object whole; R2 unless a test stands in. */
  readObject?: (storageKey: string) => Promise<Uint8Array>
}

/**
 * Checks, without reading it, that a document is one Flow may recreate a form
 * from: an uploaded document the member may view, in their own organization,
 * whose current version is a PDF, PNG or JPEG of up to 15 MB as stored. A
 * document they cannot see is not found, whichever organization holds it.
 *
 * @param input - The member, their organization and the document.
 * @param client - The caller's database client.
 * @returns The current version.
 * @throws TemplateFlowServiceError: 404 unseen, 400 generated, 409 no version,
 *   413 too large, 415 not a PDF, PNG or JPEG.
 */
export async function requireFlowSource(input: FlowSourceInput, client: TemplateFlowClient): Promise<DocumentVersion> {
  const version = await requireDocumentAccessAs(
    (async () => {
      await requireDocumentAccess(
        { ...input, operation: "read", requiredAccess: "viewer", requiredOrganizationPermissionAction: "documents:view" },
        client
      )

      const document = await getDocumentById(client, input.organizationId, input.documentId)

      if (document.lifecycleState === "trashed" || document.lifecycleState === "purge_pending") {
        throw new TemplateFlowServiceError("Document was not found.", 404)
      }

      if (document.sourceKind === "generated") {
        throw new TemplateFlowServiceError("Flow recreates forms from uploaded files, not from documents made here.", 400)
      }

      if (!document.currentVersionId) {
        throw new TemplateFlowServiceError("This file has no version Flow can read.", 409)
      }

      return getDocumentVersionById(client, input.organizationId, input.documentId, document.currentVersionId)
    })(),
    (message, statusCode) => new TemplateFlowServiceError(message, statusCode),
    "Document was not found."
  )

  if (version.status !== "available") {
    throw new TemplateFlowServiceError("This file has no version Flow can read.", 409)
  }

  assertSourceSize(version.byteSize)
  assertSourceType(version.contentType)

  return version
}

/**
 * Reads a source document {@link requireFlowSource} allows into the file the
 * model is given, once its bytes prove what it is.
 *
 * @param input - The member, their organization and the document.
 * @param deps - The caller's database client, and an object reader for tests.
 * @returns The current version's bytes, as a PDF or a picture.
 * @throws TemplateFlowServiceError as {@link requireFlowSource} and {@link toFlowAttachment}.
 */
export async function loadFlowSource(input: FlowSourceInput, deps: FlowSourceDeps): Promise<AiAttachment> {
  const version = await requireFlowSource(input, deps.client)

  // The stored type is only what the upload claimed; the bytes must agree.
  return toFlowAttachment(await (deps.readObject ?? readR2Object)(version.storageKey), version.contentType)
}

/**
 * Checks a file is one Flow reads, a PDF of up to 10 pages or a PNG or JPEG
 * picture of up to 15 MB, by its bytes.
 *
 * @param bytes - The whole file.
 * @param contentType - The type it was stored as.
 * @returns The file as the model is given it.
 * @throws TemplateFlowServiceError: 413, 415 or 422 as {@link loadFlowSource}.
 */
export async function toFlowAttachment(bytes: Uint8Array, contentType: string): Promise<AiAttachment> {
  const kind = assertSourceType(contentType)

  assertSourceSize(bytes.byteLength)

  if (!hasAllowedFileSignature(bytes, contentType)) {
    throw unreadableTypeError()
  }

  if (kind === "document") {
    const pages = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
      .then((pdf) => pdf.getPageCount())
      .catch(() => null)

    if (pages === null) {
      throw new TemplateFlowServiceError("Flow couldn't open this PDF.", 422)
    }

    if (pages > FLOW_SOURCE_MAX_PDF_PAGES) {
      throw new TemplateFlowServiceError(`Flow reads PDFs of up to ${FLOW_SOURCE_MAX_PDF_PAGES} pages.`, 422)
    }
  }

  return { kind, mimeType: contentType as AiAttachment["mimeType"], data: bytes }
}

/**
 * Keeps the answers Flow read off a form that fit the fields it made, checked
 * as a member's own answers are. The model keys each by the field key it
 * wrote, which Flow may have changed, so each moves to the field's own key.
 * Anything else is dropped, never the turn: a key no operation wrote, a value
 * its field refuses, and every signature, initials and file, since a scanned
 * signature is never anyone's act here. The answers can hold personal or
 * health data, so nothing about them is logged.
 *
 * @param answersJson - The model's JSON-encoded answers, if any.
 * @param application - The candidate draft and the keys its fields were given.
 * @returns The answers to fill a copy with, keyed by field key.
 */
export async function readSourceAnswers(
  answersJson: string | undefined,
  application: FlowApplicationResult
): Promise<Record<string, unknown>> {
  let answers: unknown

  try {
    answers = JSON.parse(answersJson ?? "{}")
  } catch {
    return {}
  }

  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return {}
  }

  const fieldByKey = collectFields(application.draft.content)
  const kept: [string, unknown][] = []

  for (const [writtenKey, value] of Object.entries(answers)) {
    const fieldKey = application.fieldKeys?.get(writtenKey)

    if (fieldKey === undefined) continue

    // With no sender given, a signature or initials box refuses any answer, and a file field is no field here.
    kept.push(...Object.entries(await normalizeAnswerPatch(fieldByKey, { [fieldKey]: value }).catch(() => ({}))))
  }

  // Defined, never assigned, so no key can reach a prototype.
  return Object.fromEntries(kept)
}

function assertSourceType(contentType: string): AiAttachment["kind"] {
  const kind = Object.hasOwn(SOURCE_KINDS, contentType) ? SOURCE_KINDS[contentType] : undefined

  if (!kind) {
    throw unreadableTypeError()
  }

  return kind
}

function unreadableTypeError(): TemplateFlowServiceError {
  return new TemplateFlowServiceError("Flow reads PDFs, PNG and JPEG pictures.", 415)
}

function assertSourceSize(byteSize: number): void {
  if (byteSize > FLOW_SOURCE_MAX_BYTES) {
    throw new TemplateFlowServiceError("Flow reads files of up to 15 MB.", 413)
  }
}

async function readR2Object(storageKey: string): Promise<Uint8Array> {
  const r2Env = getR2Env()
  const object = await createR2Client(r2Env).send(
    new GetObjectCommand({ Bucket: r2Env.CLOUDFLARE_R2_BUCKET_NAME, Key: storageKey })
  )

  // The version row was checked; this keeps an object that differs from it from being read whole.
  assertSourceSize(object.ContentLength ?? Number.POSITIVE_INFINITY)

  return (await object.Body?.transformToByteArray()) ?? new Uint8Array()
}
