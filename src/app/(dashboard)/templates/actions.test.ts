import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getAuthenticatedUser } from "@/lib/auth"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  getDocumentTemplate,
  publishDocumentTemplate,
  TemplateServiceError,
  updateDocumentTemplate,
} from "@/services/template-service"
import {
  createBlankTemplateContent,
  type DocumentTemplate,
} from "@/types/template"

import { publishTemplateAction } from "./actions"

const ACTOR_USER_ID = "20000000-0000-4000-8000-000000000001"
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001"
const TEMPLATE_ID = "30000000-0000-4000-8000-000000000001"

const { redirectMock, revalidatePathMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
  revalidatePathMock: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}))

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>()
  return { ...actual, getAuthenticatedUser: vi.fn() }
})

vi.mock("@/services/organization-service", () => ({
  getCurrentOrganizationContext: vi.fn(),
}))

vi.mock("@/services/template-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/template-service")>()

  return {
    ...actual,
    getDocumentTemplate: vi.fn(),
    publishDocumentTemplate: vi.fn(),
    updateDocumentTemplate: vi.fn(),
  }
})

describe("publish template action", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: ACTOR_USER_ID,
      email: "manager@example.com",
    })
    vi.mocked(getCurrentOrganizationContext).mockResolvedValue({
      organization: {
        id: ORGANIZATION_ID,
        name: "Acme",
        slug: "acme",
        createdBy: ACTOR_USER_ID,
        createdAt: "2026-07-18T12:00:00.000Z",
        updatedAt: "2026-07-18T12:00:00.000Z",
      },
      membership: {
        id: "membership-1",
        organizationId: ORGANIZATION_ID,
        userId: ACTOR_USER_ID,
        role: "manager",
        status: "active",
        createdAt: "2026-07-18T12:00:00.000Z",
        updatedAt: "2026-07-18T12:00:00.000Z",
      },
    })
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("publishes the exact revision returned by the save", async () => {
    const savedTemplate = createTemplate(2, "draft")
    const publishedTemplate = createTemplate(2, "published")
    vi.mocked(updateDocumentTemplate).mockResolvedValue(savedTemplate)
    vi.mocked(publishDocumentTemplate).mockResolvedValue(publishedTemplate)

    await expect(
      publishTemplateAction(createPublishFormData(1))
    ).rejects.toThrow(
      `NEXT_REDIRECT:/templates/${TEMPLATE_ID}/edit?message=Template+published.`
    )

    expect(publishDocumentTemplate).toHaveBeenCalledWith({
      actorUserId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID,
      templateId: TEMPLATE_ID,
      expectedRevision: 2,
    })
  })

  it("does not publish a newer revision discovered after a no-op save", async () => {
    vi.mocked(updateDocumentTemplate).mockRejectedValue(
      new TemplateServiceError("No template changes were provided.", 400)
    )
    vi.mocked(getDocumentTemplate).mockResolvedValue(createTemplate(2, "draft"))

    await expect(
      publishTemplateAction(createPublishFormData(1))
    ).rejects.toThrow(
      `NEXT_REDIRECT:/templates/${TEMPLATE_ID}/edit?error=Document+template+changed+since+it+was+opened.`
    )

    expect(publishDocumentTemplate).not.toHaveBeenCalled()
  })
})

function createPublishFormData(expectedRevision: number): FormData {
  const formData = new FormData()
  formData.set("templateId", TEMPLATE_ID)
  formData.set("expectedRevision", String(expectedRevision))
  formData.set("title", "Client handbook")
  formData.set("description", "")
  formData.set("content", JSON.stringify(createBlankTemplateContent()))
  return formData
}

function createTemplate(
  revision: number,
  status: "draft" | "published"
): DocumentTemplate {
  return {
    id: TEMPLATE_ID,
    organizationId: ORGANIZATION_ID,
    title: "Client handbook",
    description: null,
    status,
    revision,
    content: createBlankTemplateContent(),
    createdBy: ACTOR_USER_ID,
    updatedBy: ACTOR_USER_ID,
    publishedBy: status === "published" ? ACTOR_USER_ID : null,
    archivedBy: null,
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
    publishedAt:
      status === "published" ? "2026-07-18T12:00:00.000Z" : null,
    archivedAt: null,
  }
}
