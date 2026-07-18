import { beforeEach, describe, expect, it, vi } from "vitest"

import { getAuthenticatedUser } from "@/lib/auth"
import { createDocumentDownloadUrl } from "@/services/document-service"
import { renderGeneratedDocumentPdf } from "@/services/document-pdf-service"
import {
  finalizeGeneratedDocumentPdf,
  GeneratedDocumentFinalizationServiceError,
} from "@/services/generated-document-finalization-service"
import { getGeneratedDocumentSigningView } from "@/services/document-signing-service"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import { createBlankTemplateContent } from "@/types/template"

import { GET } from "./route"

const ACTOR_ID = "20000000-0000-4000-8000-000000000001"
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001"
const DOCUMENT_ID = "30000000-0000-4000-8000-000000000001"
const VERSION_ID = "40000000-0000-4000-8000-000000000001"

vi.mock("@/lib/auth", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  getAuthenticatedUser: vi.fn(),
}))

vi.mock("@/services/organization-service", () => ({
  OrganizationServiceError: class OrganizationServiceError extends Error {
    readonly statusCode = 500
  },
  getCurrentOrganizationContext: vi.fn(),
}))

vi.mock("@/services/document-signing-service", () => ({
  DocumentSigningServiceError: class DocumentSigningServiceError extends Error {
    readonly statusCode = 500
  },
  getGeneratedDocumentSigningView: vi.fn(),
}))

vi.mock("@/services/document-pdf-service", () => ({
  DocumentPdfServiceError: class DocumentPdfServiceError extends Error {
    readonly statusCode = 500
  },
  renderGeneratedDocumentPdf: vi.fn(),
}))

vi.mock("@/services/generated-document-finalization-service", () => ({
  GeneratedDocumentFinalizationServiceError:
    class GeneratedDocumentFinalizationServiceError extends Error {
      readonly statusCode: number

      constructor(message: string, statusCode: number) {
        super(message)
        this.name = "GeneratedDocumentFinalizationServiceError"
        this.statusCode = statusCode
      }
    },
  finalizeGeneratedDocumentPdf: vi.fn(),
}))

vi.mock("@/services/document-service", () => ({
  DocumentServiceError: class DocumentServiceError extends Error {
    readonly statusCode = 500
  },
  createDocumentDownloadUrl: vi.fn(),
}))

describe("generated document PDF route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: ACTOR_ID,
      email: "member@example.com",
    })
    vi.mocked(getCurrentOrganizationContext).mockResolvedValue({
      organization: {
        id: ORGANIZATION_ID,
        name: "Acme",
        slug: "acme",
        createdBy: ACTOR_ID,
        createdAt: "2026-07-18T12:00:00.000Z",
        updatedAt: "2026-07-18T12:00:00.000Z",
      },
      membership: {
        id: "membership-1",
        organizationId: ORGANIZATION_ID,
        userId: ACTOR_ID,
        role: "staff",
        status: "active",
        createdAt: "2026-07-18T12:00:00.000Z",
        updatedAt: "2026-07-18T12:00:00.000Z",
      },
    })
  })

  it("returns a labeled no-store preview while the document is editable", async () => {
    vi.mocked(getGeneratedDocumentSigningView).mockResolvedValue(
      createSigningView("draft")
    )
    vi.mocked(renderGeneratedDocumentPdf).mockResolvedValue(
      Buffer.from("%PDF-preview")
    )

    const response = await GET(createRequest(), createRouteContext())

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-bizflow-pdf-state")).toBe("preview")
    expect(response.headers.get("content-disposition")).toContain(
      "Client-agreement-preview.pdf"
    )
    expect(finalizeGeneratedDocumentPdf).not.toHaveBeenCalled()
    expect(createDocumentDownloadUrl).not.toHaveBeenCalled()
  })

  it("redirects completed documents to the exact audited final version", async () => {
    vi.mocked(getGeneratedDocumentSigningView).mockResolvedValue(
      createSigningView("completed")
    )
    vi.mocked(finalizeGeneratedDocumentPdf).mockResolvedValue({
      finalizationId: "50000000-0000-4000-8000-000000000001",
      versionId: VERSION_ID,
    })
    vi.mocked(createDocumentDownloadUrl).mockResolvedValue({
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      downloadUrl: "https://storage.example.com/final.pdf?signature=private",
      expiresInSeconds: 60,
    })

    const response = await GET(createRequest(), createRouteContext())

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://storage.example.com/final.pdf?signature=private"
    )
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-bizflow-pdf-state")).toBe("finalized")
    expect(renderGeneratedDocumentPdf).not.toHaveBeenCalled()
    expect(createDocumentDownloadUrl).toHaveBeenCalledWith({
      actorUserId: ACTOR_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
    })
  })

  it("maps a finalization conflict to a safe response", async () => {
    vi.mocked(getGeneratedDocumentSigningView).mockResolvedValue(
      createSigningView("completed")
    )
    vi.mocked(finalizeGeneratedDocumentPdf).mockRejectedValue(
      new GeneratedDocumentFinalizationServiceError(
        "Final document evidence does not match.",
        409
      )
    )

    const response = await GET(createRequest(), createRouteContext())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "Final document evidence does not match.",
    })
    expect(createDocumentDownloadUrl).not.toHaveBeenCalled()
    expect(renderGeneratedDocumentPdf).not.toHaveBeenCalled()
  })
})

function createRequest(): Request {
  return new Request(`https://app.example.com/api/documents/${DOCUMENT_ID}/pdf`)
}

function createRouteContext(): {
  params: Promise<{ documentId: string }>
} {
  return { params: Promise.resolve({ documentId: DOCUMENT_ID }) }
}

function createSigningView(
  workflowStatus: "draft" | "completed"
): Awaited<ReturnType<typeof getGeneratedDocumentSigningView>> {
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
      createdBy: ACTOR_ID,
      updatedBy: ACTOR_ID,
      archivedAt: null,
      createdAt: "2026-07-18T12:00:00.000Z",
      updatedAt: "2026-07-18T12:00:00.000Z",
    },
    answers: {},
    workflowStatus,
    recipients: [],
  }
}
