import { createHash, randomUUID } from "node:crypto"

import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { EncryptedPDFError, PDFDocument } from "pdf-lib"
import { z } from "zod"

import { getR2Env } from "@/lib/env"
import { normalizeRotation } from "@/lib/pdf/field-geometry"
import type { StampValue } from "@/services/document-pdf/pdf-lib-stamping"
import { stampUploadedPdf } from "@/services/document-pdf/pdf-lib-stamping"
import { createR2Client } from "@/lib/r2/client"
import type { DocumentSigningServiceDeps, SigningServiceClient } from "@/services/document-signing/contracts"
import { getDrawingDataUrl, normalizeOptionalDrawing, normalizeRequiredDrawing } from "@/services/document-signing/drawing-validation"
import { createDatabaseError, DocumentSigningServiceError, runSigningOperation } from "@/services/document-signing/errors"
import { sendSignedCopies } from "@/services/document-signing/signed-copies"
import {
  loadOrganizationName,
  loadRecipientByToken,
  mapSigningRecipient,
  markSigningRecipientViewed,
  resolveSigningClient,
} from "@/services/document-signing/persistence"
import { normalizeRecipientInputs } from "@/services/document-signing/recipient-validation"
import { assertRecipientLinkUsable, getSigningNow, hashToken, normalizeToken } from "@/services/document-signing/token-security"
import {
  inviteSigningRecipients,
  requireMemberDocumentAccess,
  requireMemberSigningDocumentLifecycle,
  requirePublicSigningDocumentLifecycle,
} from "@/services/document-signing/workflows"
import { normalizeFinalPdfFilename } from "@/services/generated-document-finalization/domain"
import {
  finalizeDocumentPdf,
  type FinalizeGeneratedDocumentPdfResult,
  type GeneratedDocumentFinalizationServiceDeps,
} from "@/services/generated-document-finalization-service"
import { type PdfField, type PdfFieldLayout, pdfFieldLayoutSchema } from "@/types/pdf-fields"
import type { DocumentSigningRecipient } from "@/types/signing"
import type { DocumentSigningRecipientRow, DocumentSigningRecipientStatus, GeneratedDocumentWorkflowStatus } from "@/types/template"
import { SIGNED_URL_MAX_TTL_SECONDS } from "@/lib/r2/stored-file"
import { signCreateOnlyPut } from "@/services/r2-objects"

/** One page of an uploaded PDF as it shows: its box in points and its turn. */
export type PdfPage = Readonly<{ height: number; rotation: 0 | 90 | 180 | 270; width: number }>

/** What the sender works with: the PDF's pages, who signs, and their fields. */
export type PdfFieldEditorView = Readonly<{
  documentId: string
  layout: PdfFieldLayout
  pages: readonly PdfPage[]
  recipients: readonly DocumentSigningRecipient[]
  revision: number
  title: string
  versionId: string
  workflowStatus: GeneratedDocumentWorkflowStatus
}>

/** What a signer sees from their link: every field, theirs to fill, and what is filled so far. */
export type PublicPdfSigningView = Readonly<{
  documentTitle: string
  fields: readonly PdfField[]
  organizationName: string
  pages: readonly PdfPage[]
  recipient: Readonly<{
    id: string
    name: string
    requiresInitials: boolean
    requiresSignature: boolean
    signerId: string
    status: DocumentSigningRecipientStatus
  }>
  signers: ReadonlyArray<Readonly<{ id: string; name: string; recipientName: string | null; status: DocumentSigningRecipientStatus | null }>>
  values: Readonly<Record<string, unknown>>
  workflowStatus: GeneratedDocumentWorkflowStatus
}>

/** Dependencies for uploaded-PDF signing; tests inject each. */
export type PdfSigningDeps = DocumentSigningServiceDeps & {
  /** The bytes of a stored upload. */
  readObject?: (storageKey: string) => Promise<Uint8Array>
  /** An address the signer's browser puts one attachment at, once. */
  signAttachmentUpload?: (file: Readonly<{ byteSize: number; contentType: string; storageKey: string }>) => Promise<{ expiresAt: string; uploadUrl: string }>
  /** Checks what arrived is the file described: its size, its type, and its first bytes. */
  verifyAttachment?: (file: Readonly<{ byteSize: number; contentType: string; storageKey: string }>) => Promise<void>
}

type CertificateRecipientRow = {
  consented_at: string | null
  email: string
  id: string
  initials_data: Record<string, unknown> | null
  name: string
  requires_signature: boolean
  signature_data: Record<string, unknown> | null
  signed_at: string | null
  signed_ip: string | null
  signer_id: string | null
  status: string
}

type MemberDocumentInput = Readonly<{ actorUserId: string; documentId: string; organizationId: string }>

type LayoutRow = {
  document_id: string
  layout: unknown
  pages: unknown
  revision: number
  version_id: string
}

const LAYOUT_COLUMNS = "document_id,version_id,pages,layout,revision"
const MAX_PDF_BYTES = 50 * 1024 * 1024
const DATE = /^\d{4}-\d{2}-\d{2}$/
const ATTACHMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"])
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
// One link cannot keep filling storage, whatever it replaces.
const MAX_ATTACHMENTS_PER_SIGNER = 10

/**
 * Opens an uploaded PDF for placing fields. The first time, its pages are read
 * from the file once, and it starts with one signer and no fields.
 *
 * @param input - The member and the document.
 * @param deps - Injected database, ids and storage for tests.
 * @returns The PDF's pages, signers, fields and who has been invited.
 * @throws DocumentSigningServiceError 404 for anything but an uploaded PDF, 400 for an unreadable one.
 */
export async function getPdfFieldEditor(input: MemberDocumentInput, deps: PdfSigningDeps = {}): Promise<PdfFieldEditorView> {
  return runSigningOperation("get_pdf_field_editor", { ...input }, async () => {
    const client = resolveSigningClient(deps.client)
    await requireMemberDocumentAccess(client, input.organizationId, input.documentId, input.actorUserId, "viewer", "read", "documents:view", "You cannot open this document.")
    await requireMemberSigningDocumentLifecycle(client, input.organizationId, input.documentId, "read", "This document is archived.")
    const document = await loadUpload(client, input)
    const row = (await loadLayout(client, input)) ?? (await startLayout(client, input, document.currentVersionId, deps))
    const [{ data: answer, error: answerError }, { data: recipients, error: recipientError }] = await Promise.all([
      client.from("document_answers").select("workflow_status").eq("document_id", input.documentId).eq("org_id", input.organizationId).maybeSingle(),
      // The round out for signing now; one declined or cancelled is over.
      client.from("document_signing_recipients").select("*").eq("document_id", input.documentId).eq("org_id", input.organizationId).is("revoked_at", null).order("invited_at", { ascending: true }),
    ])

    if (answerError || recipientError) {
      throw createDatabaseError(answerError ?? recipientError, "Unable to load who signs this document.")
    }

    return {
      documentId: input.documentId,
      layout: parseStoredLayout(row.layout),
      pages: row.pages as PdfPage[],
      recipients: ((recipients ?? []) as DocumentSigningRecipientRow[]).map(mapSigningRecipient),
      revision: Number(row.revision),
      title: document.title,
      versionId: row.version_id,
      workflowStatus: workflowOf(answer),
    }
  })
}

/**
 * Keeps the signers and fields placed on an uploaded PDF, unless someone else
 * changed them first or signers were already invited.
 *
 * @param input - The member, the document, the revision they started from, and the fields.
 * @param deps - Injected database for tests.
 * @returns The revision the fields are now at.
 * @throws DocumentSigningServiceError 400 for invalid fields, 409 when changed elsewhere or sent.
 */
export async function savePdfFieldLayout(
  input: MemberDocumentInput & Readonly<{ expectedRevision: number; layout: unknown }>,
  deps: PdfSigningDeps = {}
): Promise<{ revision: number }> {
  return runSigningOperation("save_pdf_field_layout", { ...pick(input), expectedRevision: input.expectedRevision }, async () => {
    const client = resolveSigningClient(deps.client)
    await requireMemberDocumentAccess(client, input.organizationId, input.documentId, input.actorUserId, "contributor", "mutation", "documents:send", "You cannot prepare documents for signing.")
    await requireMemberSigningDocumentLifecycle(client, input.organizationId, input.documentId, "mutation", "Archived documents cannot be sent for signing.")
    const layout = parseLayout(input.layout)
    const row = await loadLayout(client, input)

    if (!row) {
      throw new DocumentSigningServiceError("Open this PDF to place fields first.", 404)
    }

    if (layout.fields.some((field) => field.page > (row.pages as PdfPage[]).length)) {
      throw new DocumentSigningServiceError("A field is on a page this PDF doesn't have.", 400)
    }

    const { data, error } = await client
      .from("document_pdf_layouts")
      .update({ layout, revision: input.expectedRevision + 1, updated_at: getSigningNow(deps.now).toISOString(), updated_by: input.actorUserId })
      .eq("document_id", input.documentId)
      .eq("org_id", input.organizationId)
      .eq("revision", input.expectedRevision)
      .select("revision")
      .maybeSingle()

    if (error?.code === "23514") {
      throw new DocumentSigningServiceError("Fields cannot change once the PDF has been sent.", 409)
    }

    if (error) {
      throw createDatabaseError(error, "Unable to keep these fields.")
    }

    if (!data) {
      throw new DocumentSigningServiceError("These fields changed elsewhere. Reload to see them.", 409)
    }

    return { revision: Number((data as { revision: number }).revision) }
  })
}

/**
 * Sends an uploaded PDF for signing: one person for each signer, each emailed
 * their own link. Everyone with a signature field must draw one.
 *
 * @param input - The member, the document, and who fills each signer's fields.
 * @param deps - Injected database, ids, tokens, clock and email for tests.
 * @returns Who was invited.
 * @throws DocumentSigningServiceError 400 when a signer has no one or no field, 409 once sent.
 */
export async function sendPdfForSigning(
  input: MemberDocumentInput & Readonly<{ recipients: ReadonlyArray<Readonly<{ email: string; name: string; signerId: string }>> }>,
  deps: PdfSigningDeps = {}
): Promise<Readonly<{ recipients: DocumentSigningRecipient[]; undelivered: number }>> {
  return runSigningOperation("send_pdf_for_signing", { ...pick(input), recipientCount: input.recipients.length }, async () => {
    const client = resolveSigningClient(deps.client)
    await requireMemberDocumentAccess(client, input.organizationId, input.documentId, input.actorUserId, "contributor", "mutation", "documents:send", "You cannot send documents for signing.")
    await requireMemberSigningDocumentLifecycle(client, input.organizationId, input.documentId, "mutation", "Archived documents cannot be sent for signing.")
    const document = await loadUpload(client, input)
    const row = await loadLayout(client, input)
    const layout = row ? parseStoredLayout(row.layout) : null

    if (!layout || layout.fields.length === 0) {
      throw new DocumentSigningServiceError("Place a field for someone to fill first.", 400)
    }

    for (const signer of layout.signers) {
      if (!layout.fields.some((field) => field.signerId === signer.id)) {
        throw new DocumentSigningServiceError(`Give ${signer.name} a field to fill, or remove them.`, 400)
      }
    }

    const chosen = new Map(input.recipients.map((recipient) => [recipient.signerId, recipient]))

    if (chosen.size !== input.recipients.length || layout.signers.some((signer) => !chosen.has(signer.id)) || chosen.size !== layout.signers.length) {
      throw new DocumentSigningServiceError("Choose one person for each signer.", 400)
    }

    const people = normalizeRecipientInputs(layout.signers.map((signer) => ({ email: chosen.get(signer.id)!.email, name: chosen.get(signer.id)!.name })))
    // Each round starts empty, so nothing from one that was declined or cancelled is stamped.
    const { data: draft, error: answerError } = await client
      .from("document_answers")
      .update({ values: {} })
      .eq("document_id", input.documentId)
      .eq("org_id", input.organizationId)
      .eq("workflow_status", "draft")
      .select("document_id")
      .maybeSingle()

    if (answerError) {
      throw createDatabaseError(answerError, "Unable to load this document's signing.")
    }

    if (!draft) {
      throw new DocumentSigningServiceError("This PDF has already been sent.", 409)
    }

    const organizationName = await loadOrganizationName(client, input.organizationId)
    const { rows, undelivered } = await inviteSigningRecipients(
      client,
      {
        documentId: input.documentId,
        documentTitle: document.title,
        invitees: layout.signers.map((signer, index) => ({
          ...people[index]!,
          requiresSignature: layout.fields.some((field) => field.signerId === signer.id && field.kind === "signature"),
          signerId: signer.id,
        })),
        organizationId: input.organizationId,
        organizationName,
        sentBy: input.actorUserId,
      },
      deps
    )

    // Out for signing either way; an email that did not go is counted, not thrown.
    return { recipients: rows.map(mapSigningRecipient), undelivered }
  })
}

/**
 * What a signer sees from their link. Opening it the first time marks it seen.
 *
 * @param input - The private link's token.
 * @param deps - Injected database and clock for tests.
 * @returns The signer's view of the PDF's fields.
 * @throws DocumentSigningServiceError 404 for an invalid link, as for a removed document.
 */
export async function getPublicPdfSigningView(input: Readonly<{ token: string }>, deps: PdfSigningDeps = {}): Promise<PublicPdfSigningView> {
  return runSigningOperation("get_public_pdf_signing_view", {}, async () => {
    const client = resolveSigningClient(deps.client)
    const recipient = await loadRecipientByToken(client, hashToken(normalizeToken(input.token)))
    assertRecipientLinkUsable(recipient, getSigningNow(deps.now))
    await requirePublicSigningDocumentLifecycle(client, recipient, "read")
    const seen = recipient.status === "pending" ? await markSigningRecipientViewed(client, recipient, getSigningNow(deps.now).toISOString()) : recipient

    return loadPublicView(client, seen)
  })
}

/**
 * Keeps what a signer filled in and drew, then completes the document once
 * everyone has signed. A value for anyone else's field is turned away.
 *
 * @param input - The private link's token, consent, the address signed from, the signer's values by field, and their drawings.
 * @param deps - Injected database and clock for tests.
 * @returns The signer's view after signing.
 * @throws DocumentSigningServiceError 400 for invalid or missing values, 409 once the document stopped.
 */
export async function completePublicPdfSigning(
  input: Readonly<{ consented: boolean; initialsDataUrl?: string | null; ip?: string | null; signatureDataUrl?: string | null; token: string; values: unknown }>,
  deps: PdfSigningDeps = {}
): Promise<PublicPdfSigningView> {
  return runSigningOperation("complete_public_pdf_signing", {}, async () => {
    // As on a generated document, consent comes first: without it nothing is read or signed.
    if (input.consented !== true) {
      throw new DocumentSigningServiceError("Agree to sign electronically to sign.", 400)
    }

    const client = resolveSigningClient(deps.client)
    const tokenHash = hashToken(normalizeToken(input.token))
    const recipient = await loadRecipientByToken(client, tokenHash)
    assertRecipientLinkUsable(recipient, getSigningNow(deps.now))
    await requirePublicSigningDocumentLifecycle(client, recipient, recipient.status === "signed" ? "read" : "mutation")

    if (recipient.status === "signed") {
      return loadPublicView(client, recipient)
    }

    const view = await loadPublicView(client, recipient)
    const mine = view.fields.filter((field) => field.signerId === view.recipient.signerId)
    const values = parseValues(mine, input.values)
    const [signature, initials] = await Promise.all([
      view.recipient.requiresSignature ? normalizeRequiredDrawing(input.signatureDataUrl, "signature") : normalizeOptionalDrawing(input.signatureDataUrl, "signature"),
      view.recipient.requiresInitials ? normalizeRequiredDrawing(input.initialsDataUrl, "initials") : normalizeOptionalDrawing(input.initialsDataUrl, "initials"),
    ])
    const { error } = await client.rpc("complete_pdf_recipient_signature", {
      target_document_id: recipient.document_id,
      target_initials_data: initials,
      target_org_id: recipient.org_id,
      target_recipient_id: recipient.id,
      target_signature_data: signature,
      target_token_hash: tokenHash,
      target_values: values,
      target_consented: true,
      target_ip: input.ip ?? null,
    })

    if (error?.code === "22023") {
      throw new DocumentSigningServiceError(error.message, 400)
    }

    if (error) {
      throw createDatabaseError(error, "Unable to keep this signature.")
    }

    return loadPublicView(client, await loadRecipientByToken(client, tokenHash))
  })
}

/**
 * The PDF fields are placed on, for a member to see while placing them.
 *
 * @param input - The member and the document.
 * @param deps - Injected database and storage for tests.
 * @returns The PDF's bytes.
 * @throws DocumentSigningServiceError 404 before fields were started on it.
 */
export async function readPdfForPlacing(input: MemberDocumentInput, deps: PdfSigningDeps = {}): Promise<Uint8Array> {
  return runSigningOperation("read_pdf_for_placing", { ...pick(input) }, async () => {
    const client = resolveSigningClient(deps.client)
    await requireMemberDocumentAccess(client, input.organizationId, input.documentId, input.actorUserId, "viewer", "read", "documents:view", "You cannot open this document.")
    await requireMemberSigningDocumentLifecycle(client, input.organizationId, input.documentId, "read", "This document is archived.")
    return readLayoutPdf(client, input, deps)
  })
}

/**
 * The PDF a signer fills in, through their private link.
 *
 * @param input - The private link's token.
 * @param deps - Injected database, clock and storage for tests.
 * @returns The PDF's bytes.
 * @throws DocumentSigningServiceError 404 for an invalid link, as for a removed document.
 */
export async function readPdfForSigning(input: Readonly<{ token: string }>, deps: PdfSigningDeps = {}): Promise<Uint8Array> {
  return runSigningOperation("read_pdf_for_signing", {}, async () => {
    const client = resolveSigningClient(deps.client)
    const recipient = await loadRecipientByToken(client, hashToken(normalizeToken(input.token)))
    assertRecipientLinkUsable(recipient, getSigningNow(deps.now))
    await requirePublicSigningDocumentLifecycle(client, recipient, "read")
    return readLayoutPdf(client, { documentId: recipient.document_id, organizationId: recipient.org_id }, deps)
  })
}

/**
 * Whether a private signing link is for an uploaded PDF, so the signing page
 * knows which way to show it. Opening nothing, it marks nothing seen.
 *
 * @param input - The private link's token.
 * @param deps - Injected database for tests.
 * @returns "upload" for an uploaded PDF, "generated" otherwise.
 */
export async function readSigningLinkKind(input: Readonly<{ token: string }>, deps: PdfSigningDeps = {}): Promise<"generated" | "upload"> {
  return runSigningOperation("read_signing_link_kind", {}, async () => {
    const client = resolveSigningClient(deps.client)
    const recipient = await loadRecipientByToken(client, hashToken(normalizeToken(input.token)))
    const { data } = await client.from("documents").select("source_kind").eq("id", recipient.document_id).eq("org_id", recipient.org_id).maybeSingle()

    return (data as { source_kind?: string } | null)?.source_kind === "upload" ? "upload" : "generated"
  })
}

async function readLayoutPdf(client: SigningServiceClient, input: Readonly<{ documentId: string; organizationId: string }>, deps: PdfSigningDeps): Promise<Uint8Array> {
  const row = await loadLayout(client, input)
  const { data, error } = await client
    .from("document_versions")
    .select("storage_key")
    .eq("id", row?.version_id ?? "")
    .eq("document_id", input.documentId)
    .eq("org_id", input.organizationId)
    .maybeSingle()

  if (error) {
    throw createDatabaseError(error, "Unable to load this document's file.")
  }

  if (!data) {
    throw new DocumentSigningServiceError("This document has no PDF to show.", 404)
  }

  return (deps.readObject ?? readStoredObject)((data as { storage_key: string }).storage_key)
}

/**
 * Finalizes a signed upload: a copy of the PDF with every value written where
 * its field was placed, stored once and never changed, becomes the document's
 * newest version. The upload itself stays as it was.
 *
 * @param input - The member and the document.
 * @param deps - Injected database, storage and finalization ports for tests.
 * @returns The finalization and the version it made.
 * @throws GeneratedDocumentFinalizationServiceError 409 until everyone has signed.
 */
export async function finalizeUploadedPdf(
  input: MemberDocumentInput,
  deps: GeneratedDocumentFinalizationServiceDeps & Pick<PdfSigningDeps, "readObject"> = {}
): Promise<FinalizeGeneratedDocumentPdfResult> {
  return finalizeDocumentPdf(input, deps, (getClient) => async () => {
    const client = getClient()
    const document = await loadUpload(client, input)
    const row = await loadLayout(client, input)

    if (!row) {
      throw new DocumentSigningServiceError("This PDF has no fields.", 404)
    }

    const layout = parseStoredLayout(row.layout)
    const [answers, recipients, version, attachments] = await Promise.all([
      client.from("document_answers").select("values,workflow_status").eq("document_id", input.documentId).eq("org_id", input.organizationId).maybeSingle(),
      client.from("document_signing_recipients").select("id,signer_id,name,email,status,requires_signature,signed_at,consented_at,signed_ip,signature_data,initials_data").eq("document_id", input.documentId).eq("org_id", input.organizationId).is("revoked_at", null),
      client.from("document_versions").select("storage_key").eq("id", row.version_id).eq("document_id", input.documentId).eq("org_id", input.organizationId).maybeSingle(),
      client.from("document_signing_attachments").select("id,original_filename").eq("document_id", input.documentId).eq("org_id", input.organizationId).eq("status", "available"),
    ])
    const failed = answers.error ?? recipients.error ?? version.error ?? attachments.error

    if (failed || !version.data) {
      throw createDatabaseError(failed, "Unable to load this document's signing.")
    }

    const rows = (recipients.data ?? []) as CertificateRecipientRow[]
    // The certificate lists signers in the order their roles were set out.
    const order = new Map(layout.signers.map((signer, index) => [signer.id, index]))
    const signers = rows
      .filter((row) => row.status === "signed")
      .sort((a, b) => (order.get(a.signer_id ?? "") ?? 0) - (order.get(b.signer_id ?? "") ?? 0))
      .map((row) => ({
        consentedAt: row.consented_at,
        email: row.email,
        id: row.id,
        name: row.name,
        requiresSignature: row.requires_signature,
        signedAt: row.signed_at,
        signedIp: row.signed_ip,
        status: "signed" as const,
      }))
    const values = stampValuesOf(
      layout.fields,
      ((answers.data as { values?: Record<string, unknown> } | null)?.values ?? {}) as Record<string, unknown>,
      rows,
      new Map(((attachments.data ?? []) as Array<{ id: string; original_filename: string }>).map((attachment) => [attachment.id, attachment.original_filename]))
    )

    return {
      completed: workflowOf(answers.data) === "completed",
      filename: normalizeFinalPdfFilename(document.title),
      render: async (metadataTimestamp: string) =>
        stampUploadedPdf({
          certificate: { documentId: input.documentId, signers },
          fields: layout.fields,
          metadataTimestamp,
          source: await (deps.readObject ?? readStoredObject)((version.data as { storage_key: string }).storage_key),
          title: document.title,
          values,
        }),
      sha256: createHash("sha256").update(JSON.stringify({ layout, signers, values, versionId: row.version_id })).digest("hex"),
    }
  })
}

// What goes on the page for each field: the words given, a readable date, a
// tick, what was attached, or the signer's own drawing.
function stampValuesOf(
  fields: readonly PdfField[],
  answers: Readonly<Record<string, unknown>>,
  recipients: ReadonlyArray<{ initials_data: Record<string, unknown> | null; signature_data: Record<string, unknown> | null; signer_id: string | null }>,
  attachments: ReadonlyMap<string, string>
): Record<string, StampValue> {
  const values: Record<string, StampValue> = {}

  for (const field of fields) {
    const answer = answers[field.id]
    const signer = recipients.find((recipient) => recipient.signer_id === field.signerId)
    const drawing = field.kind === "signature" ? getDrawingDataUrl(signer?.signature_data ?? null) : field.kind === "initials" ? getDrawingDataUrl(signer?.initials_data ?? null) : null

    if (drawing) {
      values[field.id] = { dataUrl: drawing, kind: "drawing" }
    } else if (field.kind === "checkbox" && answer === true) {
      values[field.id] = { kind: "checked" }
    } else if (field.kind === "date" && typeof answer === "string" && DATE.test(answer)) {
      values[field.id] = { kind: "text", text: SHOWN_DATE.format(new Date(`${answer}T00:00:00Z`)) }
    } else if (field.kind === "attachment" && typeof answer === "string" && attachments.has(answer)) {
      values[field.id] = { kind: "text", text: `Attached: ${attachments.get(answer)}` }
    } else if (field.kind === "text" && typeof answer === "string" && answer.trim()) {
      values[field.id] = { kind: "text", text: answer }
    }
  }

  return values
}

const SHOWN_DATE = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" })

/**
 * Once the last signer of an uploaded PDF has signed: stamps the signed copy
 * as the document's sender and emails every signer and the sender a link to
 * it. Best effort, run after the signer's response; a copy that fails here is
 * still made the first time someone downloads it.
 *
 * @param input - The private link of the signer who signed last.
 * @param deps - Injected database, storage and email for tests.
 * @returns Whether the signed copy was made.
 */
export async function finalizeSignedUpload(
  input: Readonly<{ token: string }>,
  deps: GeneratedDocumentFinalizationServiceDeps & Pick<PdfSigningDeps, "readObject"> = {}
): Promise<boolean> {
  const client = resolveSigningClient(deps.client as SigningServiceClient | undefined)
  const recipient = await loadRecipientByToken(client, hashToken(normalizeToken(input.token)))
  const { data } = await client.from("documents").select("created_by").eq("id", recipient.document_id).eq("org_id", recipient.org_id).maybeSingle()

  return finalizeCompletedUpload(
    { createdBy: (data as { created_by: string | null } | null)?.created_by ?? null, documentId: recipient.document_id, organizationId: recipient.org_id },
    deps
  )
}

/** A signed upload whose copy is still to be made, and who made it. */
type CompletedUpload = Readonly<{ createdBy: string | null; documentId: string; organizationId: string }>

/**
 * Finishes signed uploads whose copy was never made, as the hourly sweep does
 * for generated documents: a finalizing that failed after the last signature
 * gets another go.
 *
 * @param deps - Injected listing, database, storage and email for tests.
 * @returns How many were looked at, and how many now have their copy.
 */
export async function finalizeCompletedUploads(
  deps: GeneratedDocumentFinalizationServiceDeps &
    Pick<PdfSigningDeps, "readObject"> & { listUnfinalized?: (limit: number) => Promise<readonly CompletedUpload[]> } = {}
): Promise<{ finalizedCount: number; scannedCount: number }> {
  const uploads = await (deps.listUnfinalized ?? ((limit: number) => listUnfinalizedUploads(resolveSigningClient(deps.client as SigningServiceClient | undefined), limit)))(10)
  let finalizedCount = 0

  // One at a time: each stamps a whole PDF.
  for (const upload of uploads) {
    if (await finalizeCompletedUpload(upload, deps)) {
      finalizedCount += 1
    }
  }

  return { finalizedCount, scannedCount: uploads.length }
}

async function finalizeCompletedUpload(
  upload: CompletedUpload,
  deps: GeneratedDocumentFinalizationServiceDeps & Pick<PdfSigningDeps, "readObject">
): Promise<boolean> {
  // ponytail: a document whose sender is gone gets its copy on the first download instead.
  if (!upload.createdBy) {
    return false
  }

  const document = { documentId: upload.documentId, organizationId: upload.organizationId }
  const finalized = await finalizeUploadedPdf({ actorUserId: upload.createdBy, ...document }, deps).then(
    () => true,
    () => false
  )

  if (finalized) {
    // Once only: a document whose copies went out is left alone.
    await (deps.sendSignedCopies ?? sendSignedCopies)(document).catch(() => undefined)
  }

  return finalized
}

async function listUnfinalizedUploads(client: SigningServiceClient, limit: number): Promise<CompletedUpload[]> {
  const { data, error } = await client.rpc("list_unfinalized_uploaded_pdfs", { target_limit: limit })

  if (error || !Array.isArray(data)) {
    throw createDatabaseError(error, "Unable to list signed uploads to finish.")
  }

  return (data as Array<{ created_by: string | null; document_id: string; org_id: string }>).map((row) => ({
    createdBy: row.created_by,
    documentId: row.document_id,
    organizationId: row.org_id,
  }))
}

/**
 * Starts a signer's attachment for one of their attachment fields: an address
 * their browser puts the file at, once, before it counts.
 *
 * @param input - The private link's token, the field, and the file's name, type and size.
 * @param deps - Injected database, ids and storage signer for tests.
 * @returns The attachment's id and where to put the file.
 * @throws DocumentSigningServiceError 400 for a file or field that can't be used, 409 once signed.
 */
export async function createPdfAttachmentUpload(
  input: Readonly<{ byteSize: number; contentType: string; fieldId: string; filename: string; token: string }>,
  deps: PdfSigningDeps = {}
): Promise<{ attachmentId: string; expiresAt: string; uploadUrl: string }> {
  return runSigningOperation("create_pdf_attachment_upload", {}, async () => {
    const client = resolveSigningClient(deps.client)
    const recipient = await loadSigningRecipient(client, input.token, deps)
    const row = await loadLayout(client, { documentId: recipient.document_id, organizationId: recipient.org_id })
    const field = row ? parseStoredLayout(row.layout).fields.find((candidate) => candidate.id === input.fieldId) : undefined
    const filename = input.filename.replace(/[\\/\u0000-\u001f]/g, "").trim().slice(0, 255)

    if (!field || field.kind !== "attachment" || field.signerId !== recipient.signer_id) {
      throw new DocumentSigningServiceError("That field isn't yours to attach to.", 400)
    }

    if (!ATTACHMENT_TYPES.has(input.contentType) || !Number.isSafeInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > MAX_ATTACHMENT_BYTES || !filename) {
      throw new DocumentSigningServiceError("Attach a PDF or a picture of up to 10 MB.", 400)
    }

    const { data: attached, error: countError } = await client
      .from("document_signing_attachments")
      .select("id")
      .eq("recipient_id", recipient.id)
      .eq("org_id", recipient.org_id)

    if (countError) {
      throw createDatabaseError(countError, "Unable to start this attachment.")
    }

    // ponytail: count-then-insert lets a burst of parallel starts pass the cap by a few; a constraint if that matters.
    if ((attached ?? []).length >= MAX_ATTACHMENTS_PER_SIGNER) {
      throw new DocumentSigningServiceError(`You can attach up to ${MAX_ATTACHMENTS_PER_SIGNER} files.`, 409)
    }

    const attachmentId = (deps.createId ?? randomUUID)()
    const storageKey = `organizations/${recipient.org_id}/documents/${recipient.document_id}/attachments/${attachmentId}`
    const { error } = await client.from("document_signing_attachments").insert({
      byte_size: input.byteSize,
      content_type: input.contentType,
      document_id: recipient.document_id,
      field_id: field.id,
      id: attachmentId,
      org_id: recipient.org_id,
      original_filename: filename,
      recipient_id: recipient.id,
      storage_key: storageKey,
    })

    if (error) {
      throw createDatabaseError(error, "Unable to start this attachment.")
    }

    const upload = await (deps.signAttachmentUpload ?? signStoredUpload)({ byteSize: input.byteSize, contentType: input.contentType, storageKey })
    return { attachmentId, ...upload }
  })
}

/**
 * Counts a signer's attachment once its file has arrived and is what it said.
 *
 * @param input - The private link's token and the attachment.
 * @param deps - Injected database and storage check for tests.
 * @returns The attachment's id and name.
 * @throws DocumentSigningServiceError 404 for someone else's attachment, 409 until the file arrives whole.
 */
export async function confirmPdfAttachmentUpload(
  input: Readonly<{ attachmentId: string; token: string }>,
  deps: PdfSigningDeps = {}
): Promise<{ attachmentId: string; filename: string }> {
  return runSigningOperation("confirm_pdf_attachment_upload", {}, async () => {
    const client = resolveSigningClient(deps.client)
    const recipient = await loadSigningRecipient(client, input.token, deps)
    const { data, error } = await client
      .from("document_signing_attachments")
      .select("id,storage_key,content_type,byte_size,original_filename,status")
      .eq("id", input.attachmentId)
      .eq("recipient_id", recipient.id)
      .eq("org_id", recipient.org_id)
      .maybeSingle()

    if (error) {
      throw createDatabaseError(error, "Unable to load this attachment.")
    }

    const attachment = data as { byte_size: number; content_type: string; id: string; original_filename: string; status: string; storage_key: string } | null

    if (!attachment) {
      throw new DocumentSigningServiceError("That attachment isn't here.", 404)
    }

    if (attachment.status !== "available") {
      await (deps.verifyAttachment ?? verifyStoredUpload)({ byteSize: Number(attachment.byte_size), contentType: attachment.content_type, storageKey: attachment.storage_key })
      const { error: updateError } = await client
        .from("document_signing_attachments")
        .update({ status: "available" })
        .eq("id", attachment.id)
        .eq("org_id", recipient.org_id)

      if (updateError) {
        throw createDatabaseError(updateError, "Unable to keep this attachment.")
      }
    }

    return { attachmentId: attachment.id, filename: attachment.original_filename }
  })
}

// A signer still signing, through a usable link to an active document.
async function loadSigningRecipient(client: SigningServiceClient, token: string, deps: PdfSigningDeps): Promise<DocumentSigningRecipientRow> {
  const recipient = await loadRecipientByToken(client, hashToken(normalizeToken(token)))
  assertRecipientLinkUsable(recipient, getSigningNow(deps.now))
  await requirePublicSigningDocumentLifecycle(client, recipient, "mutation")

  if (recipient.status === "signed") {
    throw new DocumentSigningServiceError("You have already signed.", 409)
  }

  return recipient
}

async function signStoredUpload(file: Readonly<{ byteSize: number; contentType: string; storageKey: string }>): Promise<{ expiresAt: string; uploadUrl: string }> {
  const env = getR2Env()
  // Create-only, as every upload is: a file can never be put over another.
  const expiresIn = Math.min(env.CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS, SIGNED_URL_MAX_TTL_SECONDS)
  const uploadUrl = await signCreateOnlyPut(getSignedUrl, createR2Client(env), {
    bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
    byteSize: file.byteSize,
    contentType: file.contentType,
    expiresIn,
    key: file.storageKey,
  })

  return { expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString(), uploadUrl }
}

async function verifyStoredUpload(file: Readonly<{ byteSize: number; contentType: string; storageKey: string }>): Promise<void> {
  const env = getR2Env()
  const r2 = createR2Client(env)
  const head = await r2.send(new HeadObjectCommand({ Bucket: env.CLOUDFLARE_R2_BUCKET_NAME, Key: file.storageKey })).catch(() => null)

  if (!head || head.ContentLength !== file.byteSize || head.ContentType?.split(";")[0]?.trim().toLowerCase() !== file.contentType) {
    throw new DocumentSigningServiceError("The attachment hasn't finished uploading.", 409)
  }

  const start = await r2.send(new GetObjectCommand({ Bucket: env.CLOUDFLARE_R2_BUCKET_NAME, Key: file.storageKey, Range: "bytes=0-7" }))
  const bytes = start.Body ? await start.Body.transformToByteArray() : new Uint8Array()
  const begins = (...expected: number[]) => expected.every((value, index) => bytes[index] === value)
  const matches =
    file.contentType === "application/pdf" ? begins(0x25, 0x50, 0x44, 0x46, 0x2d) : file.contentType === "image/png" ? begins(0x89, 0x50, 0x4e, 0x47) : begins(0xff, 0xd8, 0xff)

  if (!matches) {
    throw new DocumentSigningServiceError("That file isn't the kind it says it is.", 400)
  }
}

// Only this signer's fields, each in the shape its kind takes.
function parseValues(mine: readonly PdfField[], raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new DocumentSigningServiceError("Fill in the fields first.", 400)
  }

  const kept: Record<string, unknown> = {}

  for (const [fieldId, value] of Object.entries(raw)) {
    const field = mine.find((candidate) => candidate.id === fieldId)
    const parsed = field ? VALUE_SCHEMAS[field.kind]?.safeParse(value) : undefined

    if (!parsed?.success) {
      throw new DocumentSigningServiceError(field ? `Check ${field.label ?? `the ${field.kind}`}.` : "A value was given for a field that isn't yours.", 400)
    }

    if (parsed.data !== "" && parsed.data !== false) {
      kept[fieldId] = parsed.data
    }
  }

  return kept
}

const VALUE_SCHEMAS: Partial<Record<PdfField["kind"], z.ZodType>> = {
  attachment: z.string().uuid(),
  checkbox: z.boolean(),
  date: z.string().regex(DATE).refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Not a date."),
  text: z.string().trim().max(500),
}

async function loadPublicView(client: SigningServiceClient, recipient: DocumentSigningRecipientRow): Promise<PublicPdfSigningView> {
  const input = { documentId: recipient.document_id, organizationId: recipient.org_id }
  const [document, row, organizationName, answers, recipients] = await Promise.all([
    loadUpload(client, input),
    loadLayout(client, input),
    loadOrganizationName(client, recipient.org_id),
    client.from("document_answers").select("values,workflow_status").eq("document_id", input.documentId).eq("org_id", input.organizationId).maybeSingle(),
    client.from("document_signing_recipients").select("id,name,signer_id,status").eq("document_id", input.documentId).eq("org_id", input.organizationId).is("revoked_at", null),
  ])

  if (!row || !recipient.signer_id) {
    throw new DocumentSigningServiceError("This signing link is invalid or no longer available.", 404)
  }

  if (answers.error || recipients.error) {
    throw createDatabaseError(answers.error ?? recipients.error, "Unable to load this document.")
  }

  const layout = parseStoredLayout(row.layout)
  const people = (recipients.data ?? []) as Array<{ id: string; name: string; signer_id: string | null; status: DocumentSigningRecipientStatus }>
  const mine = layout.fields.filter((field) => field.signerId === recipient.signer_id)

  return {
    documentTitle: document.title,
    fields: layout.fields,
    organizationName,
    pages: row.pages as PdfPage[],
    recipient: {
      id: recipient.id,
      name: recipient.name,
      requiresInitials: mine.some((field) => field.kind === "initials" && field.required),
      requiresSignature: recipient.requires_signature,
      signerId: recipient.signer_id,
      status: recipient.status,
    },
    signers: layout.signers.map((signer) => {
      const person = people.find((candidate) => candidate.signer_id === signer.id)
      return { id: signer.id, name: signer.name, recipientName: person?.name ?? null, status: person?.status ?? null }
    }),
    values: ((answers.data as { values?: Record<string, unknown> } | null)?.values ?? {}) as Record<string, unknown>,
    workflowStatus: workflowOf(answers.data),
  }
}

async function loadUpload(
  client: SigningServiceClient,
  input: Readonly<{ documentId: string; organizationId: string }>
): Promise<{ currentVersionId: string | null; title: string }> {
  const { data, error } = await client
    .from("documents")
    .select("id,title,source_kind,current_version_id")
    .eq("id", input.documentId)
    .eq("org_id", input.organizationId)
    .maybeSingle()

  if (error) {
    throw createDatabaseError(error, "Unable to load this document.")
  }

  const row = data as { current_version_id: string | null; source_kind: string; title: string } | null

  if (!row || row.source_kind !== "upload") {
    throw new DocumentSigningServiceError("This document has no PDF to place fields on.", 404)
  }

  return { currentVersionId: row.current_version_id, title: row.title }
}

async function loadLayout(client: SigningServiceClient, input: Readonly<{ documentId: string; organizationId: string }>): Promise<LayoutRow | null> {
  const { data, error } = await client
    .from("document_pdf_layouts")
    .select(LAYOUT_COLUMNS)
    .eq("document_id", input.documentId)
    .eq("org_id", input.organizationId)
    .maybeSingle()

  if (error) {
    throw createDatabaseError(error, "Unable to load this PDF's fields.")
  }

  return data as LayoutRow | null
}

// The first time: the current version must be a readable PDF; its pages are kept.
async function startLayout(client: SigningServiceClient, input: MemberDocumentInput, versionId: string | null, deps: PdfSigningDeps): Promise<LayoutRow> {
  // Opening is a read, but the first open writes the fields down: only someone who may send them starts them.
  await requireMemberDocumentAccess(client, input.organizationId, input.documentId, input.actorUserId, "contributor", "mutation", "documents:send", "You cannot prepare documents for signing.")
  const { data: version, error } = await client
    .from("document_versions")
    .select("id,storage_key,content_type,status,byte_size")
    .eq("id", versionId ?? "")
    .eq("document_id", input.documentId)
    .eq("org_id", input.organizationId)
    .maybeSingle()

  if (error) {
    throw createDatabaseError(error, "Unable to load this document's file.")
  }

  const file = version as { byte_size: number; content_type: string; id: string; status: string; storage_key: string } | null

  if (!file || file.status !== "available" || file.content_type !== "application/pdf") {
    throw new DocumentSigningServiceError("Fields can be placed on a PDF only.", 400)
  }

  if (Number(file.byte_size) > MAX_PDF_BYTES) {
    throw new DocumentSigningServiceError("This PDF is too large to place fields on.", 400)
  }

  const pages = await readPages(await (deps.readObject ?? readStoredObject)(file.storage_key))
  const row = {
    document_id: input.documentId,
    layout: { fields: [], signers: [{ id: (deps.createId ?? randomUUID)(), name: "Signer 1" }] },
    org_id: input.organizationId,
    pages,
    revision: 1,
    updated_by: input.actorUserId,
    version_id: file.id,
  }
  // tenant-scope: the row inserted carries org_id: input.organizationId
  const { error: insertError } = await client.from("document_pdf_layouts").insert(row)

  // Opened twice at once: the other one's is kept.
  if (insertError && insertError.code !== "23505") {
    throw createDatabaseError(insertError, "Unable to start placing fields.")
  }

  const { data: answer } = await client.from("document_answers").select("document_id").eq("document_id", input.documentId).eq("org_id", input.organizationId).maybeSingle()

  if (!answer) {
    const { error: answerError } = await client.from("document_answers").insert({ document_id: input.documentId, org_id: input.organizationId, values: {}, workflow_status: "draft" })

    if (answerError && answerError.code !== "23505") {
      throw createDatabaseError(answerError, "Unable to start placing fields.")
    }
  }

  return (await loadLayout(client, input)) ?? row
}

async function readPages(bytes: Uint8Array): Promise<PdfPage[]> {
  let pdf: PDFDocument

  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (error: unknown) {
    throw new DocumentSigningServiceError(
      error instanceof EncryptedPDFError ? "This PDF is locked with a password, so fields can't be placed on it." : "This file couldn't be read as a PDF.",
      400
    )
  }

  const pages = pdf.getPages().map((page) => {
    const box = page.getCropBox()
    return { height: box.height, rotation: normalizeRotation(page.getRotation().angle), width: box.width }
  })

  if (pages.length === 0 || pages.length > 2_000) {
    throw new DocumentSigningServiceError("This PDF has no pages to place fields on.", 400)
  }

  return pages
}

async function readStoredObject(storageKey: string): Promise<Uint8Array> {
  const env = getR2Env()
  const result = await createR2Client(env).send(new GetObjectCommand({ Bucket: env.CLOUDFLARE_R2_BUCKET_NAME, Key: storageKey }))

  if (!result.Body) {
    throw new DocumentSigningServiceError("This document's file is missing.", 404)
  }

  return result.Body.transformToByteArray()
}


function parseLayout(value: unknown): PdfFieldLayout {
  const parsed = pdfFieldLayoutSchema.safeParse(value)

  if (!parsed.success) {
    throw new DocumentSigningServiceError(parsed.error.issues[0]?.message ?? "These fields could not be kept.", 400)
  }

  return parsed.data
}

function parseStoredLayout(value: unknown): PdfFieldLayout {
  const parsed = pdfFieldLayoutSchema.safeParse(value)

  if (!parsed.success) {
    throw new DocumentSigningServiceError("This PDF's fields could not be read.", 500)
  }

  return parsed.data
}

function workflowOf(answer: unknown): GeneratedDocumentWorkflowStatus {
  const status = (answer as { workflow_status?: unknown } | null)?.workflow_status

  return status === "awaiting_signatures" || status === "completed" ? status : "draft"
}

function pick(input: MemberDocumentInput): MemberDocumentInput {
  return { actorUserId: input.actorUserId, documentId: input.documentId, organizationId: input.organizationId }
}
