import { beforeEach, describe, expect, it, vi } from "vitest"

import { getAuthenticatedUser } from "@/lib/auth"
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit"
import { findGuestOrganizationId } from "@/services/document-service"
import { renderGeneratedDocumentDocx } from "@/services/document-docx-service"
import { DocumentSigningServiceError, getGeneratedDocumentSigningView } from "@/services/document-signing-service"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import { createBlankTemplateContent } from "@/types/template"

import { GET } from "./route"

const ACTOR_ID = "20000000-0000-4000-8000-000000000001"
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001"
const DOCUMENT_ID = "30000000-0000-4000-8000-000000000001"

vi.mock("@/lib/auth", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  getAuthenticatedUser: vi.fn(),
}))

vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: vi.fn(),
}))

vi.mock("@/services/organization-service", () => ({
  OrganizationServiceError: class OrganizationServiceError extends Error {
    readonly statusCode = 500
  },
  getCurrentOrganizationContext: vi.fn(),
}))

vi.mock("@/services/document-signing-service", () => ({
  DocumentSigningServiceError: class DocumentSigningServiceError extends Error {
    constructor(
      message: string,
      readonly statusCode: number
    ) {
      super(message)
    }
  },
  getGeneratedDocumentSigningView: vi.fn(),
}))

vi.mock("@/services/document-docx-service", () => ({
  DOCX_CONTENT_TYPE: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  renderGeneratedDocumentDocx: vi.fn(async () => Buffer.from("PK-docx")),
}))

vi.mock("@/services/document-service", () => ({
  DocumentServiceError: class DocumentServiceError extends Error {
    readonly statusCode = 500
  },
  findGuestOrganizationId: vi.fn(async () => null),
}))

describe("generated document Word route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkRateLimit).mockResolvedValue(undefined)
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: ACTOR_ID, email: "member@example.com" })
    vi.mocked(getCurrentOrganizationContext).mockResolvedValue({ organization: { id: ORGANIZATION_ID } } as Awaited<ReturnType<typeof getCurrentOrganizationContext>>)
  })

  it("gives a member a private Word copy of a completed document from the snapshot it was signed on", async () => {
    vi.mocked(getGeneratedDocumentSigningView).mockResolvedValue(createSigningView("completed"))

    const response = await GET(createRequest(), createRouteContext())

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="Client-agreement.docx"')
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(getGeneratedDocumentSigningView).toHaveBeenCalledWith({ actorUserId: ACTOR_ID, documentId: DOCUMENT_ID, organizationId: ORGANIZATION_ID })
    expect(vi.mocked(renderGeneratedDocumentDocx).mock.calls[0]?.[0]).toMatchObject({
      content: createBlankTemplateContent(),
      signers: [expect.objectContaining({ email: "pat@example.com", signatureDataUrl: "data:image/png;base64,AAAA" })],
      workflowStatus: "completed",
    })
  })

  it.each([
    ["another workspace's document", 404],
    ["a document the member cannot open", 403],
  ])("refuses %s before rendering it", async (_case: string, statusCode: number) => {
    vi.mocked(getGeneratedDocumentSigningView).mockRejectedValue(new DocumentSigningServiceError("You cannot view this document.", statusCode))

    const response = await GET(createRequest(), createRouteContext())

    expect(response.status).toBe(statusCode)
    expect(renderGeneratedDocumentDocx).not.toHaveBeenCalled()
  })

  it("refuses someone with no workspace who is not the document's guest", async () => {
    vi.mocked(getCurrentOrganizationContext).mockResolvedValue(null)

    const response = await GET(createRequest(), createRouteContext())

    expect(response.status).toBe(403)
    expect(getGeneratedDocumentSigningView).not.toHaveBeenCalled()
    expect(renderGeneratedDocumentDocx).not.toHaveBeenCalled()
  })

  it("gives a guest the copy the PDF gives them: signers without their addresses or drawings", async () => {
    vi.mocked(findGuestOrganizationId).mockResolvedValueOnce(ORGANIZATION_ID)
    vi.mocked(getGeneratedDocumentSigningView).mockResolvedValue({
      ...createSigningView("completed"),
      guest: true,
      recipients: [{ id: "signer-1", name: "Pat Signer", requiresSignature: true, signedAt: "2026-07-18T13:00:00.000Z", status: "signed" }],
    })

    const response = await GET(createRequest(), createRouteContext())

    expect(response.status).toBe(200)
    expect(vi.mocked(renderGeneratedDocumentDocx).mock.calls[0]?.[0].signers).toEqual([
      expect.objectContaining({ email: "", initialsDataUrl: null, name: "Pat Signer", signatureDataUrl: null }),
    ])
  })

  it("spends a render from the member's bucket, as the PDF does", async () => {
    vi.mocked(checkRateLimit).mockImplementation(async (bucket, key) => {
      if (bucket === "pdf_render_user" && key === ACTOR_ID) throw new RateLimitError(20)
    })

    const response = await GET(createRequest(), createRouteContext())

    expect(response.status).toBe(429)
    expect(renderGeneratedDocumentDocx).not.toHaveBeenCalled()
  })
})

function createRequest(): Request {
  return new Request(`https://app.example.com/api/documents/${DOCUMENT_ID}/docx`)
}

function createRouteContext(): { params: Promise<{ documentId: string }> } {
  return { params: Promise.resolve({ documentId: DOCUMENT_ID }) }
}

function createSigningView(workflowStatus: "draft" | "completed"): Awaited<ReturnType<typeof getGeneratedDocumentSigningView>> {
  return {
    organizationName: "Acme",
    document: {
      id: DOCUMENT_ID,
      organizationId: ORGANIZATION_ID,
      folderId: null,
      title: "Client agreement",
      description: null,
      sourceKind: "generated",
      templateId: null,
      templateRevision: null,
      templateSnapshot: createBlankTemplateContent(),
      lifecycleState: "active",
      createdBy: ACTOR_ID,
      updatedBy: ACTOR_ID,
      archivedAt: null,
      trashedAt: null,
      purgeAfter: null,
      createdAt: "2026-07-18T12:00:00.000Z",
      updatedAt: "2026-07-18T12:00:00.000Z",
    },
    answers: {},
    workflowStatus,
    recipients: [
      {
        id: "signer-1",
        name: "Pat Signer",
        email: "pat@example.com",
        requiresSignature: true,
        status: "signed",
        signedAt: "2026-07-18T13:00:00.000Z",
        signatureDataUrl: "data:image/png;base64,AAAA",
        initialsDataUrl: null,
      },
    ],
  } as Awaited<ReturnType<typeof getGeneratedDocumentSigningView>>
}
