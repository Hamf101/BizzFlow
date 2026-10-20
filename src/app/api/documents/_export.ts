import { NextResponse } from "next/server"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { resolveDocumentOrganizationId } from "@/lib/document-organization"
import { captureUnexpectedError, describeErrorForLog } from "@/lib/observability"
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit"
import { createRateLimitResponse } from "@/lib/rate-limit-response"
import { DOCX_CONTENT_TYPE } from "@/services/document-docx-service"
import { DocumentServiceError } from "@/services/document-service"
import { DocumentPdfServiceError, type RenderGeneratedDocumentPdfInput } from "@/services/document-pdf-service"
import { GeneratedDocumentFinalizationServiceError } from "@/services/generated-document-finalization-service"
import { getGeneratedDocumentSigningView, DocumentSigningServiceError } from "@/services/document-signing-service"
import { OrganizationServiceError } from "@/services/organization-service"
import { readTemplateImage } from "@/services/template-image-service"
import type { DocumentSigningRecipient, PublicSignerStatus } from "@/types/signing"
import type { TemplateImageAsset } from "@/types/template"

type SigningView = Awaited<ReturnType<typeof getGeneratedDocumentSigningView>>

/** A document someone may download, read as the PDF and Word copies print it. */
export type DocumentExport = Readonly<{
  input: RenderGeneratedDocumentPdfInput
  organizationId: string
  readImage: (asset: TemplateImageAsset) => Promise<Uint8Array>
  userId: string
  view: SigningView
}>

/**
 * Signs the reader in and reads one document they may open, in the workspace
 * it belongs to for them, after spending a render from both buckets: every
 * download re-renders, so a hot loop on one document and a sweep across many
 * are both bounded.
 *
 * @param documentId - The document asked for.
 * @returns The document, its render input and how to read its pictures.
 * @throws DocumentSigningServiceError without a workspace or access; RateLimitError past a limit.
 */
export async function loadDocumentExport(documentId: string): Promise<DocumentExport> {
  const user = await getAuthenticatedUser()
  const organizationId = await resolveDocumentOrganizationId(user.id, documentId)

  if (!organizationId) {
    throw new DocumentSigningServiceError("Create or join an organization before downloading documents.", 403)
  }

  await checkRateLimit("pdf_render", `${organizationId}:${documentId}`)
  await checkRateLimit("pdf_render_user", user.id)

  const view = await getGeneratedDocumentSigningView({ actorUserId: user.id, organizationId, documentId })

  return {
    input: {
      documentId: view.document.id,
      title: view.document.title,
      content: view.document.templateSnapshot,
      answers: view.answers,
      workflowStatus: view.workflowStatus,
      // A guest's copy shows its signers as a signing link shows co-signers.
      signers: view.recipients.map((recipient: PublicSignerStatus & Partial<DocumentSigningRecipient>) => ({
        id: recipient.id,
        name: recipient.name,
        email: recipient.email ?? "",
        requiresSignature: recipient.requiresSignature,
        status: recipient.status,
        signedAt: recipient.signedAt,
        signatureDataUrl: recipient.signatureDataUrl ?? null,
        initialsDataUrl: recipient.initialsDataUrl ?? null,
      })),
    },
    organizationId,
    readImage: (asset: TemplateImageAsset) => readTemplateImage(organizationId, asset),
    userId: user.id,
    view,
  }
}

/**
 * A download's file name: the title in letters, digits and a few marks safe
 * in a header, at most 120 of them.
 *
 * @param title - The document's title.
 * @param extension - "pdf" or "docx".
 * @param suffix - Added after the title, such as "preview".
 */
export function exportFilename(title: string, extension: string, suffix?: string): string {
  const safeStem = title
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)

  return `${safeStem || "document"}${suffix ? `-${suffix}` : ""}.${extension}`
}

/**
 * Converts a download's failure into a safe JSON answer: 429 with its retry
 * hint, 401 signed out, a known error's own status and message, and a logged,
 * reported 500 that says nothing of the cause.
 *
 * @param format - "pdf" or "docx", naming the route in logs.
 * @param failure - What a 500 says.
 */
export function documentExportErrorResponse(error: unknown, documentId: string | undefined, format: string, failure: string): Response {
  if (error instanceof RateLimitError) {
    return createRateLimitResponse(error, "document_route_rejected", `documents_${format}`)
  }

  if (error instanceof AuthenticationError) {
    return NextResponse.json({ error: error.message }, { status: 401 })
  }

  const known =
    error instanceof DocumentSigningServiceError ||
    error instanceof DocumentPdfServiceError ||
    error instanceof GeneratedDocumentFinalizationServiceError ||
    error instanceof DocumentServiceError ||
    error instanceof OrganizationServiceError

  if (!known || error.statusCode >= 500) {
    console.error(`generated_document_${format}_route_failed`, { documentId, ...describeErrorForLog(error) })
  }

  if (known) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }

  captureUnexpectedError(error, { routeName: `documents_${format}`, documentId })
  return NextResponse.json({ error: failure }, { status: 500 })
}

/**
 * A private, never-cached .docx download.
 *
 * @param docx - The file's bytes.
 * @param filename - A header-safe name, from exportFilename.
 */
export function docxDownload(docx: Buffer, filename: string): Response {
  return new Response(new Uint8Array(docx), {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(docx.length),
      "Content-Type": DOCX_CONTENT_TYPE,
    },
  })
}
