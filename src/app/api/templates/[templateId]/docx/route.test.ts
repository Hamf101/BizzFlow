import { beforeEach, describe, expect, it, vi } from "vitest"

import { getAuthenticatedUser } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { renderGeneratedDocumentDocx } from "@/services/document-docx-service"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import { canEditDocumentTemplate, getDocumentTemplate } from "@/services/template-service"
import { createBlankTemplateContent, type DocumentTemplate } from "@/types/template"

import { GET } from "./route"

const ACTOR_ID = "20000000-0000-4000-8000-000000000001"
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001"
const TEMPLATE_ID = "50000000-0000-4000-8000-000000000001"

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

vi.mock("@/services/template-service", async (importOriginal) => ({
  TemplateServiceError: (await importOriginal<typeof import("@/services/template-service")>()).TemplateServiceError,
  canEditDocumentTemplate: vi.fn(),
  getDocumentTemplate: vi.fn(),
}))

vi.mock("@/services/document-docx-service", () => ({
  DOCX_CONTENT_TYPE: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  renderGeneratedDocumentDocx: vi.fn(async () => Buffer.from("PK-docx")),
}))

describe("template Word route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkRateLimit).mockResolvedValue(undefined)
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: ACTOR_ID, email: "member@example.com" })
    vi.mocked(getCurrentOrganizationContext).mockResolvedValue({ organization: { id: ORGANIZATION_ID } } as Awaited<ReturnType<typeof getCurrentOrganizationContext>>)
    vi.mocked(getDocumentTemplate).mockResolvedValue({ content: createBlankTemplateContent(), id: TEMPLATE_ID, organizationId: ORGANIZATION_ID, title: "Intake form" } as DocumentTemplate)
  })

  it("gives an editor the template as a blank Word form", async () => {
    vi.mocked(canEditDocumentTemplate).mockResolvedValue(true)

    const response = await GET(new Request("https://app.example.com"), { params: Promise.resolve({ templateId: TEMPLATE_ID }) })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="Intake-form.docx"')
    expect(canEditDocumentTemplate).toHaveBeenCalledWith({ actorUserId: ACTOR_ID, organizationId: ORGANIZATION_ID, templateId: TEMPLATE_ID })
    expect(vi.mocked(renderGeneratedDocumentDocx).mock.calls[0]?.[0]).toMatchObject({ answers: {}, title: "Intake form", workflowStatus: "draft" })
  })

  it("refuses anyone the template editor would turn away, before reading or rendering it", async () => {
    vi.mocked(canEditDocumentTemplate).mockResolvedValue(false)

    const response = await GET(new Request("https://app.example.com"), { params: Promise.resolve({ templateId: TEMPLATE_ID }) })

    expect(response.status).toBe(403)
    expect(getDocumentTemplate).not.toHaveBeenCalled()
    expect(renderGeneratedDocumentDocx).not.toHaveBeenCalled()
  })
})
