import { declinePublicDocumentSigning } from "@/services/document-signing-service"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import { degrees, PDFDocument } from "pdf-lib"
import { describe, expect, it, vi } from "vitest"

import {
  DOCUMENT_ID,
  DRAWING_DATA_URL,
  FakeClient,
  type FakeRow,
  MANAGER_ID,
  NOW,
  ORG_ID,
} from "@/services/document-signing-service.test-support"
import type { SendDocumentSigningEmailInput } from "@/services/document-signing-email-service"
import type { PdfField, PdfFieldLayout } from "@/types/pdf-fields"

import {
  completePublicPdfSigning,
  confirmPdfAttachmentUpload,
  createPdfAttachmentUpload,
  finalizeCompletedUploads,
  finalizeSignedUpload,
  finalizeUploadedPdf,
  getPdfFieldEditor,
  getPublicPdfSigningView,
  type PdfSigningDeps,
  savePdfFieldLayout,
  sendPdfForSigning,
} from "./pdf-signing-service"

const VERSION_ID = "31000000-0000-4000-8000-000000000001"
const TENANT = "50000000-0000-4000-8000-000000000001"
const LANDLORD = "50000000-0000-4000-8000-000000000002"
const id = (n: number): string => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const NAME = id(1)
const AGREE = id(2)
const SIGN = id(3)
const DATE = id(4)
const PROOF = id(5)
const member = { actorUserId: MANAGER_ID, documentId: DOCUMENT_ID, organizationId: ORG_ID }

const field = (fieldId: string, signerId: string, kind: PdfField["kind"], page = 1): PdfField => ({
  fontSize: null,
  height: 0.04,
  id: fieldId,
  kind,
  label: null,
  page,
  required: true,
  signerId,
  width: 0.3,
  x: 0.1,
  y: 0.5,
})
const LAYOUT = {
  fields: [field(NAME, TENANT, "text"), field(AGREE, TENANT, "checkbox"), field(SIGN, TENANT, "signature"), field(DATE, LANDLORD, "date", 2)],
  signers: [
    { id: TENANT, name: "Tenant" },
    { id: LANDLORD, name: "Landlord" },
  ],
} satisfies PdfFieldLayout

// A signing database with one uploaded PDF, and the completion an upload's signers go through.
class UploadClient extends FakeClient {
  readonly completions: Array<Record<string, unknown>> = []

  override async rpc(functionName: string, args: Record<string, unknown>) {
    if (functionName !== "complete_pdf_recipient_signature") {
      return super.rpc(functionName, args)
    }

    this.completions.push(args)
    const recipient = this.tables.document_signing_recipients!.find((row) => row.id === args.target_recipient_id)!
    const answer = this.tables.document_answers!.find((row) => row.document_id === args.target_document_id)!
    Object.assign(recipient, { signature_data: args.target_signature_data, signed_at: NOW.toISOString(), status: "signed" })
    answer.values = { ...(answer.values as FakeRow), ...(args.target_values as FakeRow) }
    answer.workflow_status = this.tables.document_signing_recipients!.every((row) => row.status === "signed") ? "completed" : "awaiting_signatures"
    return { data: answer.workflow_status, error: null }
  }
}

async function upload(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.addPage([612, 792])
  pdf.addPage([600, 800]).setRotation(degrees(90))
  return pdf.save()
}

function harness(access: "contributor" | "viewer" = "contributor") {
  const client = new UploadClient({
    document_effective_access: [{ access_level: access, document_id: DOCUMENT_ID, org_id: ORG_ID, user_id: MANAGER_ID }],
    document_signing_recipients: [],
    document_versions: [
      { byte_size: 2_048, content_type: "application/pdf", document_id: DOCUMENT_ID, id: VERSION_ID, org_id: ORG_ID, status: "available", storage_key: "organizations/o/documents/d/lease.pdf" },
    ],
    documents: [
      { archived_at: null, created_by: MANAGER_ID, current_version_id: VERSION_ID, id: DOCUMENT_ID, lifecycle_state: "active", org_id: ORG_ID, source_kind: "upload", title: "Lease agreement" },
    ],
    organization_memberships: [{ org_id: ORG_ID, role: "manager", status: "active", user_id: MANAGER_ID }],
    organizations: [{ id: ORG_ID, name: "Northwind Property" }],
    profiles: [{ email: "manager@example.com", id: MANAGER_ID }],
  })
  const ids = [TENANT, id(90), id(91)]
  let tokens = 0
  const deps = {
    client: client as never,
    createId: () => ids.shift() ?? id(99),
    createToken: () => `token_${(tokens += 1)}_abcdefghijklmnopqrstuvwxyz0123456789`,
    now: () => NOW,
    readObject: vi.fn(upload),
    sendDocumentSigningEmail: vi.fn<(invitation: SendDocumentSigningEmailInput) => Promise<void>>(async () => undefined),
  } satisfies PdfSigningDeps

  return { client, deps }
}

describe("fields on an uploaded PDF", () => {
  it("reads the PDF's pages once, starts with one signer, and keeps the fields placed on it", async () => {
    const { deps } = harness()

    const opened = await getPdfFieldEditor(member, deps)
    expect(opened.pages).toEqual([
      { height: 792, rotation: 0, width: 612 },
      { height: 800, rotation: 90, width: 600 },
    ])
    expect(opened.layout).toEqual({ fields: [], signers: [{ id: TENANT, name: "Signer 1" }] })
    expect(opened.workflowStatus).toBe("draft")

    expect(await savePdfFieldLayout({ ...member, expectedRevision: opened.revision, layout: LAYOUT }, deps)).toEqual({ revision: 2 })
    const again = await getPdfFieldEditor(member, deps)
    expect(again.layout).toEqual(LAYOUT)
    expect(again.revision).toBe(2)
    expect(deps.readObject).toHaveBeenCalledTimes(1)
  })

  it("keeps no field off the PDF's pages, nothing over someone else's newer fields, and nothing from a viewer, who cannot even start them", async () => {
    const { deps } = harness()
    const { revision } = await getPdfFieldEditor(member, deps)
    const offPage = { ...LAYOUT, fields: [field(NAME, TENANT, "text", 3)] }

    await expect(savePdfFieldLayout({ ...member, expectedRevision: revision, layout: offPage }, deps)).rejects.toMatchObject({ statusCode: 400 })
    await expect(savePdfFieldLayout({ ...member, expectedRevision: revision + 5, layout: LAYOUT }, deps)).rejects.toMatchObject({ statusCode: 409 })

    const viewer = harness("viewer")
    await expect(getPdfFieldEditor(member, viewer.deps)).rejects.toMatchObject({ statusCode: 403 })
    expect(viewer.client.tables.document_pdf_layouts ?? []).toEqual([])
    expect(viewer.client.tables.document_answers ?? []).toEqual([])
    await expect(savePdfFieldLayout({ ...member, expectedRevision: 1, layout: LAYOUT }, viewer.deps)).rejects.toMatchObject({ statusCode: 403 })
  })

  it("sends it to one person for each signer, and only someone with a signature field must sign", async () => {
    const { client, deps } = harness()
    await savePdfFieldLayout({ ...member, expectedRevision: (await getPdfFieldEditor(member, deps)).revision, layout: LAYOUT }, deps)

    await expect(sendPdfForSigning({ ...member, recipients: [{ email: "jordan@example.com", name: "Jordan Ellis", signerId: TENANT }] }, deps)).rejects.toMatchObject({ statusCode: 400 })

    const sent = await sendPdfForSigning(
      {
        ...member,
        recipients: [
          { email: "sam@example.com", name: "Sam Rivera", signerId: LANDLORD },
          { email: "jordan@example.com", name: "Jordan Ellis", signerId: TENANT },
        ],
      },
      deps
    )

    expect(sent.undelivered).toBe(0)
    expect(sent.recipients.map((recipient) => [recipient.name, recipient.requiresSignature])).toEqual([
      ["Jordan Ellis", true],
      ["Sam Rivera", false],
    ])
    expect(client.tables.document_signing_recipients!.map((row) => row.signer_id)).toEqual([TENANT, LANDLORD])
    expect(client.tables.document_answers![0]).toMatchObject({ workflow_status: "awaiting_signatures" })
    expect(deps.sendDocumentSigningEmail).toHaveBeenCalledTimes(2)
    await expect(
      sendPdfForSigning({ ...member, recipients: [{ email: "a@example.com", name: "A", signerId: TENANT }, { email: "b@example.com", name: "B", signerId: LANDLORD }] }, deps)
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it("lets a signer decline with a reason: the PDF is the sender's draft again, to send afresh, and the sender hears why", async () => {
    const { client, deps } = harness()
    await savePdfFieldLayout({ ...member, expectedRevision: (await getPdfFieldEditor(member, deps)).revision, layout: LAYOUT }, deps)
    await sendPdfForSigning(
      {
        ...member,
        recipients: [
          { email: "jordan@example.com", name: "Jordan Ellis", signerId: TENANT },
          { email: "sam@example.com", name: "Sam Rivera", signerId: LANDLORD },
        ],
      },
      deps
    )
    const [tenant] = vi.mocked(deps.sendDocumentSigningEmail).mock.calls.map(([invitation]) => invitation.token)
    const sendDocumentSigningDeclinedEmail = vi.fn(async () => undefined)

    expect(await declinePublicDocumentSigning({ reason: "The rent is wrong.", token: tenant! }, { ...deps, sendDocumentSigningDeclinedEmail })).toEqual({
      documentTitle: "Lease agreement",
      organizationName: "Northwind Property",
    })
    expect(client.tables.document_answers![0]).toMatchObject({ workflow_status: "draft" })
    expect(sendDocumentSigningDeclinedEmail).toHaveBeenCalledWith(expect.objectContaining({ documentTitle: "Lease agreement", reason: "The rent is wrong." }))

    // The sender can send it again: the declined round's signers and answers are gone from it.
    client.tables.document_answers![0]!.values = { [DATE]: "2026-01-01" }
    expect((await getPdfFieldEditor(member, deps)).recipients).toEqual([])
    await sendPdfForSigning(
      {
        ...member,
        recipients: [
          { email: "casey@example.com", name: "Casey Moore", signerId: TENANT },
          { email: "sam@example.com", name: "Sam Rivera", signerId: LANDLORD },
        ],
      },
      deps
    )
    expect(client.tables.document_answers![0]).toMatchObject({ values: {}, workflow_status: "awaiting_signatures" })
    expect((await getPdfFieldEditor(member, deps)).recipients.map((recipient) => recipient.name)).toEqual(["Casey Moore", "Sam Rivera"])
  })

  it("lets a signer fill only their own fields, each in its own shape, and sign", async () => {
    const { client, deps } = harness()
    await savePdfFieldLayout({ ...member, expectedRevision: (await getPdfFieldEditor(member, deps)).revision, layout: LAYOUT }, deps)
    await sendPdfForSigning(
      {
        ...member,
        recipients: [
          { email: "jordan@example.com", name: "Jordan Ellis", signerId: TENANT },
          { email: "sam@example.com", name: "Sam Rivera", signerId: LANDLORD },
        ],
      },
      deps
    )
    const token = vi.mocked(deps.sendDocumentSigningEmail).mock.calls[0]![0].token
    const view = await getPublicPdfSigningView({ token }, deps)

    expect(view.recipient).toMatchObject({ requiresSignature: true, signerId: TENANT, status: "viewed" })
    expect(view.signers.map((signer) => [signer.name, signer.recipientName])).toEqual([
      ["Tenant", "Jordan Ellis"],
      ["Landlord", "Sam Rivera"],
    ])
    await expect(completePublicPdfSigning({ consented: true, ip: "203.0.113.7", signatureDataUrl: DRAWING_DATA_URL, token, values: { [DATE]: "2026-09-29" } }, deps)).rejects.toMatchObject({ statusCode: 400 })
    await expect(completePublicPdfSigning({ consented: true, ip: "203.0.113.7", signatureDataUrl: DRAWING_DATA_URL, token, values: { [AGREE]: "yes" } }, deps)).rejects.toMatchObject({ statusCode: 400 })
    await expect(completePublicPdfSigning({ consented: true, ip: "203.0.113.7", signatureDataUrl: null, token, values: { [NAME]: "Jordan Ellis" } }, deps)).rejects.toMatchObject({ statusCode: 400 })
    // Without agreeing to sign electronically, nothing is signed.
    await expect(completePublicPdfSigning({ consented: false, signatureDataUrl: DRAWING_DATA_URL, token, values: { [AGREE]: true, [NAME]: "Jordan Ellis" } }, deps)).rejects.toMatchObject({ statusCode: 400 })
    expect(client.completions).toEqual([])

    const signed = await completePublicPdfSigning({ consented: true, ip: "203.0.113.7", signatureDataUrl: DRAWING_DATA_URL, token, values: { [AGREE]: true, [NAME]: "  Jordan Ellis " } }, deps)

    expect(client.completions).toHaveLength(1)
    expect(client.completions[0]).toMatchObject({ target_consented: true, target_ip: "203.0.113.7", target_values: { [AGREE]: true, [NAME]: "Jordan Ellis" } })
    expect(signed.recipient.status).toBe("signed")
    expect(signed.values).toEqual({ [AGREE]: true, [NAME]: "Jordan Ellis" })
  })

  it("stamps everyone's values onto a copy that becomes the newest version, once everyone has signed", async () => {
    const { client, deps } = harness()
    await savePdfFieldLayout({ ...member, expectedRevision: (await getPdfFieldEditor(member, deps)).revision, layout: LAYOUT }, deps)
    await sendPdfForSigning(
      {
        ...member,
        recipients: [
          { email: "jordan@example.com", name: "Jordan Ellis", signerId: TENANT },
          { email: "sam@example.com", name: "Sam Rivera", signerId: LANDLORD },
        ],
      },
      deps
    )
    const [tenant, landlord] = vi.mocked(deps.sendDocumentSigningEmail).mock.calls.map(([invitation]) => invitation.token)
    const stored: Uint8Array[] = []
    const finalize = {
      ...deps,
      createId: () => "70000000-0000-4000-8000-000000000001",
      persistence: {
        findByDocument: vi.fn(async () => null),
        prepare: vi.fn(async (prepared: { finalizationId: string; renderInputSha256: string; storageKey: string }) => ({
          byteSize: null,
          createdAt: "2026-09-29T09:00:00.000Z",
          documentVersionId: null,
          id: prepared.finalizationId,
          pdfSha256: null,
          renderInputSha256: prepared.renderInputSha256,
          status: "pending" as const,
          storageKey: prepared.storageKey,
        })),
        listUnfinalized: vi.fn(async () => []),
        promote: vi.fn(async () => "71000000-0000-4000-8000-000000000001"),
        requireViewPermission: vi.fn(async () => undefined),
      },
      storage: { store: vi.fn(async ({ pdf }: { pdf: Uint8Array }) => void stored.push(pdf)) },
    }

    await completePublicPdfSigning({ consented: true, ip: "203.0.113.7", signatureDataUrl: DRAWING_DATA_URL, token: tenant!, values: { [AGREE]: true, [NAME]: "Jordan Ellis" } }, deps)
    await expect(finalizeUploadedPdf(member, finalize)).rejects.toMatchObject({ statusCode: 409 })
    expect(finalize.storage.store).not.toHaveBeenCalled()

    await completePublicPdfSigning({ consented: true, ip: "203.0.113.7", token: landlord!, values: { [DATE]: "2026-09-29" } }, deps)
    expect(client.tables.document_answers![0]).toMatchObject({ workflow_status: "completed" })
    expect(await finalizeUploadedPdf(member, finalize)).toEqual({
      finalizationId: "70000000-0000-4000-8000-000000000001",
      versionId: "71000000-0000-4000-8000-000000000001",
    })

    const pdf = await getDocument({ data: new Uint8Array(stored[0]!) }).promise
    const words = async (page: number) =>
      (await (await pdf.getPage(page)).getTextContent()).items.map((item) => ("str" in item ? item.str : "")).filter(Boolean)
    expect(await words(1)).toEqual(["Jordan Ellis"])
    expect(await words(2)).toEqual(["Sep 29, 2026"])
    // The copy closes with the signing certificate, naming both signers.
    expect((await words(3)).join(" ")).toEqual(expect.stringContaining("Signing certificate"))
    expect((await words(3)).join(" ")).toEqual(expect.stringContaining("sam@example.com"))
    expect(finalize.persistence.promote).toHaveBeenCalledWith(expect.objectContaining({ originalFilename: "Lease-agreement-final.pdf" }))

    // The hourly sweep finishes any signed upload whose copy was never made, as its sender.
    const swept = vi.fn(async () => 2)
    expect(
      await finalizeCompletedUploads({
        ...finalize,
        listUnfinalized: async () => [{ createdBy: MANAGER_ID, documentId: DOCUMENT_ID, organizationId: ORG_ID }],
        sendSignedCopies: swept,
      })
    ).toEqual({ finalizedCount: 1, scannedCount: 1 })
    expect(swept).toHaveBeenCalledWith({ documentId: DOCUMENT_ID, organizationId: ORG_ID })

    // Right after the last signature, the signed copy is made as its sender and everyone is sent it.
    const sendSignedCopies = vi.fn(async () => 3)
    expect(await finalizeSignedUpload({ token: landlord! }, { ...finalize, sendSignedCopies })).toBe(true)
    expect(sendSignedCopies).toHaveBeenCalledWith({ documentId: DOCUMENT_ID, organizationId: ORG_ID })
  })

  it("takes an attachment only for the signer's own attachment field, and counts it once what arrived checks out", async () => {
    const { client, deps } = harness()
    const layout = { ...LAYOUT, fields: [...LAYOUT.fields, { ...field(PROOF, LANDLORD, "attachment"), required: false }] }
    await savePdfFieldLayout({ ...member, expectedRevision: (await getPdfFieldEditor(member, deps)).revision, layout }, deps)
    await sendPdfForSigning(
      {
        ...member,
        recipients: [
          { email: "jordan@example.com", name: "Jordan Ellis", signerId: TENANT },
          { email: "sam@example.com", name: "Sam Rivera", signerId: LANDLORD },
        ],
      },
      deps
    )
    const [tenant, landlord] = vi.mocked(deps.sendDocumentSigningEmail).mock.calls.map(([invitation]) => invitation.token)
    const checked: string[] = []
    const storage = {
      ...deps,
      createId: () => "72000000-0000-4000-8000-000000000001",
      signAttachmentUpload: vi.fn(async () => ({ expiresAt: NOW.toISOString(), uploadUrl: "https://files.example/put" })),
      verifyAttachment: vi.fn(async ({ storageKey }: { storageKey: string }) => void checked.push(storageKey)),
    }
    const file = { byteSize: 2_048, contentType: "application/pdf", fieldId: PROOF, filename: "../proof of income.pdf" }

    await expect(createPdfAttachmentUpload({ ...file, token: tenant! }, storage)).rejects.toMatchObject({ statusCode: 400 })
    await expect(createPdfAttachmentUpload({ ...file, contentType: "text/html", token: landlord! }, storage)).rejects.toMatchObject({ statusCode: 400 })
    await expect(createPdfAttachmentUpload({ ...file, byteSize: 11 * 1024 * 1024, token: landlord! }, storage)).rejects.toMatchObject({ statusCode: 400 })

    const started = await createPdfAttachmentUpload({ ...file, token: landlord! }, storage)
    expect(started).toEqual({ attachmentId: "72000000-0000-4000-8000-000000000001", expiresAt: NOW.toISOString(), uploadUrl: "https://files.example/put" })
    // Waiting on the file: the database starts it as pending.
    expect(client.tables.document_signing_attachments![0]).toMatchObject({ original_filename: "..proof of income.pdf" })
    expect(client.tables.document_signing_attachments![0]).not.toHaveProperty("status")
    await expect(confirmPdfAttachmentUpload({ attachmentId: started.attachmentId, token: tenant! }, storage)).rejects.toMatchObject({ statusCode: 404 })

    expect(await confirmPdfAttachmentUpload({ attachmentId: started.attachmentId, token: landlord! }, storage)).toEqual({
      attachmentId: started.attachmentId,
      filename: "..proof of income.pdf",
    })
    expect(checked).toEqual([`organizations/${ORG_ID}/documents/${DOCUMENT_ID}/attachments/${started.attachmentId}`])
    expect(client.tables.document_signing_attachments![0]).toMatchObject({ status: "available" })

    // One link cannot keep filling storage: ten files is all a signer gets.
    const attached = client.tables.document_signing_attachments!
    attached.push(...Array.from({ length: 9 }, (_, n) => ({ ...attached[0]!, id: id(200 + n), storage_key: `${attached[0]!.storage_key as string}-${n}` })))
    await expect(createPdfAttachmentUpload({ ...file, token: landlord! }, storage)).rejects.toMatchObject({ statusCode: 409 })
    expect(attached).toHaveLength(10)
  })
})

