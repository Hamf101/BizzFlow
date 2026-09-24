import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  archiveDocumentTemplate,
  createDocumentTemplate,
  duplicateDocumentTemplate,
  getDocumentTemplate,
  publishDocumentTemplate,
  TemplateServiceError,
  updateDocumentTemplate,
} from "@/services/template-service"
import {
  createBlankTemplateContent,
  type DocumentTemplate,
} from "@/types/template"

import {
  archiveTemplateAction,
  createTemplateAction,
  duplicateTemplateAction,
  publishTemplateAction,
  updateTemplateAction,
} from "./actions"

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
    archiveDocumentTemplate: vi.fn(),
    createDocumentTemplate: vi.fn(),
    duplicateDocumentTemplate: vi.fn(),
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
    vi.mocked(archiveDocumentTemplate).mockResolvedValue({ id: TEMPLATE_ID } as never)
    vi.mocked(createDocumentTemplate).mockResolvedValue(createTemplate(1, "draft"))
    vi.mocked(duplicateDocumentTemplate).mockResolvedValue({
      id: "40000000-0000-4000-8000-000000000001",
    } as never)
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
      `NEXT_REDIRECT:/templates/${TEMPLATE_ID}/edit?feedback=template_published`
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
      `NEXT_REDIRECT:/templates/${TEMPLATE_ID}/edit?feedback=refresh_required`
    )

    expect(publishDocumentTemplate).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Document+template+changed")
    )
  })
})

describe("template mutation outcomes", () => {
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
    vi.mocked(createDocumentTemplate).mockResolvedValue(createTemplate(1, "draft"))
    vi.mocked(updateDocumentTemplate).mockResolvedValue(createTemplate(2, "draft"))
    vi.mocked(archiveDocumentTemplate).mockResolvedValue({ id: TEMPLATE_ID } as never)
    vi.mocked(duplicateDocumentTemplate).mockResolvedValue({
      id: "40000000-0000-4000-8000-000000000001",
    } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("creates a draft and opens its editor with a stable outcome", async () => {
    const formData = new FormData()
    formData.set("title", "Client handbook")
    formData.set("description", "Internal policies")

    await expect(createTemplateAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/templates/${TEMPLATE_ID}/edit?feedback=template_created`
    )
    expect(createDocumentTemplate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        actorUserId: ACTOR_USER_ID,
        organizationId: ORGANIZATION_ID,
        title: "Client handbook",
      })
    )
  })

  it("saves the submitted revision before reporting completion", async () => {
    await expect(updateTemplateAction(createPublishFormData(1))).rejects.toThrow(
      `NEXT_REDIRECT:/templates/${TEMPLATE_ID}/edit?feedback=changes_saved`
    )
    expect(updateDocumentTemplate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        actorUserId: ACTOR_USER_ID,
        organizationId: ORGANIZATION_ID,
        templateId: TEMPLATE_ID,
        expectedRevision: 1,
      })
    )
  })

  it.each([
    ["reports an unchanged draft as saved", 1, "changes_saved"],
    ["asks for a refresh when an unchanged draft is out of date", 2, "refresh_required"],
  ])("%s instead of an input error", async (_case, storedRevision, feedback) => {
    // Undo can return the editor to exactly the saved state, so Save must not
    // answer a harmless no-op with "check your input".
    vi.mocked(updateDocumentTemplate).mockRejectedValue(
      new TemplateServiceError("No template changes were provided.", 400)
    )
    vi.mocked(getDocumentTemplate).mockResolvedValue(
      createTemplate(storedRevision, "draft")
    )

    await expect(updateTemplateAction(createPublishFormData(1))).rejects.toThrow(
      `NEXT_REDIRECT:/templates/${TEMPLATE_ID}/edit?feedback=${feedback}`
    )
  })

  it("archives only after the service succeeds", async () => {
    const formData = new FormData()
    formData.set("templateId", TEMPLATE_ID)

    await expect(archiveTemplateAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/templates?feedback=resource_archived"
    )
    expect(archiveDocumentTemplate).toHaveBeenCalledExactlyOnceWith({
      actorUserId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID,
      templateId: TEMPLATE_ID,
    })
  })

  it("opens the duplicated template and preserves its returned id", async () => {
    const formData = new FormData()
    formData.set("templateId", TEMPLATE_ID)

    await expect(duplicateTemplateAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/templates/40000000-0000-4000-8000-000000000001/edit?feedback=template_duplicated"
    )
  })

  it("maps invalid editor input to fixed copy", async () => {
    const formData = createPublishFormData(1)
    formData.set("content", "not-json")

    await expect(updateTemplateAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/templates/${TEMPLATE_ID}/edit?feedback=invalid_input`
    )
    expect(updateDocumentTemplate).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalledWith(
      expect.stringContaining("not-json")
    )
  })

  it("preserves the exact editor return path when authentication expires", async () => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(
      new AuthenticationError("Sign in to continue.")
    )

    await expect(updateTemplateAction(createPublishFormData(1))).rejects.toThrow(
      `NEXT_REDIRECT:/login?next=%2Ftemplates%2F${TEMPLATE_ID}%2Fedit`
    )
    expect(updateDocumentTemplate).not.toHaveBeenCalled()
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
    category: null,
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
