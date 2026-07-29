import { beforeEach, describe, expect, it, vi } from "vitest"

import { getAuthenticatedUser } from "@/lib/auth"
import {
  archiveDocument,
  archiveFolder,
  DocumentServiceError,
  restoreDocument,
  restoreFolder,
  trashDocument,
  trashFolder,
} from "@/services/document-service"
import { getCurrentOrganizationContext } from "@/services/organization-service"

import {
  archiveDocumentAction,
  archiveFolderAction,
  restoreDocumentAction,
  restoreFolderAction,
  trashDocumentAction,
  trashFolderAction,
} from "./actions"

const {
  redirectMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
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
  return {
    ...actual,
    getAuthenticatedUser: vi.fn(),
  }
})

vi.mock("@/services/document-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/document-service")>()

  return {
    ...actual,
    archiveDocument: vi.fn(),
    archiveFolder: vi.fn(),
    restoreDocument: vi.fn(),
    restoreFolder: vi.fn(),
    trashDocument: vi.fn(),
    trashFolder: vi.fn(),
  }
})

vi.mock("@/services/organization-service", () => ({
  getCurrentOrganizationContext: vi.fn(),
}))

const ACTOR_USER_ID = "20000000-0000-4000-8000-000000000001"
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001"
const DOCUMENT_ID = "30000000-0000-4000-8000-000000000001"
const FOLDER_ID = "40000000-0000-4000-8000-000000000001"
const PARENT_FOLDER_ID = "50000000-0000-4000-8000-000000000001"
const DETAIL_PATH = `/documents/${DOCUMENT_ID}`

beforeEach((): void => {
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
      createdAt: "2026-07-28T12:00:00.000Z",
      updatedAt: "2026-07-28T12:00:00.000Z",
    },
    membership: {
      id: "membership-1",
      organizationId: ORGANIZATION_ID,
      userId: ACTOR_USER_ID,
      role: "manager",
      status: "active",
      createdAt: "2026-07-28T12:00:00.000Z",
      updatedAt: "2026-07-28T12:00:00.000Z",
    },
  })
  vi.mocked(archiveDocument).mockResolvedValue(undefined as never)
  vi.mocked(restoreDocument).mockResolvedValue(undefined as never)
  vi.mocked(trashDocument).mockResolvedValue(undefined as never)
  vi.mocked(archiveFolder).mockResolvedValue(undefined as never)
  vi.mocked(restoreFolder).mockResolvedValue(undefined as never)
  vi.mocked(trashFolder).mockResolvedValue(undefined as never)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("document lifecycle actions", (): void => {
  it.each([
    {
      action: archiveDocumentAction,
      operation: archiveDocument,
      message: "Document+archived.",
    },
    {
      action: restoreDocumentAction,
      operation: restoreDocument,
      message: "Document+restored.",
    },
    {
      action: trashDocumentAction,
      operation: trashDocument,
      message: "Document+moved+to+Trash.",
    },
  ])(
    "derives document lifecycle tenant scope from authenticated context",
    async ({ action, operation, message }): Promise<void> => {
      await expect(action(createDocumentForm())).rejects.toThrow(
        `NEXT_REDIRECT:${DETAIL_PATH}?message=${message}`
      )

      expect(operation).toHaveBeenCalledExactlyOnceWith({
        actorUserId: ACTOR_USER_ID,
        organizationId: ORGANIZATION_ID,
        documentId: DOCUMENT_ID,
      })
      expect(revalidatePathMock).toHaveBeenCalledWith("/documents")
      expect(revalidatePathMock).toHaveBeenCalledWith(DETAIL_PATH)
    }
  )

  it("returns a lifecycle service error to the document detail page", async (): Promise<void> => {
    vi.mocked(trashDocument).mockRejectedValue(
      new DocumentServiceError("Document is already in Trash.", 409)
    )

    await expect(trashDocumentAction(createDocumentForm())).rejects.toThrow(
      `NEXT_REDIRECT:${DETAIL_PATH}?error=Document+is+already+in+Trash.`
    )
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

describe("folder lifecycle actions", (): void => {
  it.each([
    {
      action: archiveFolderAction,
      operation: archiveFolder,
      message: "Folder+archived.",
    },
    {
      action: restoreFolderAction,
      operation: restoreFolder,
      message: "Folder+restored.",
    },
    {
      action: trashFolderAction,
      operation: trashFolder,
      message: "Folder+moved+to+Trash.",
    },
  ])(
    "derives folder lifecycle tenant scope and preserves the safe return path",
    async ({ action, operation, message }): Promise<void> => {
      await expect(action(createFolderForm("archived"))).rejects.toThrow(
        `NEXT_REDIRECT:/documents?view=archived&folderId=${PARENT_FOLDER_ID}&message=${message}`
      )

      expect(operation).toHaveBeenCalledExactlyOnceWith({
        actorUserId: ACTOR_USER_ID,
        organizationId: ORGANIZATION_ID,
        folderId: FOLDER_ID,
      })
      expect(revalidatePathMock).toHaveBeenCalledExactlyOnceWith(
        "/documents"
      )
    }
  )

  it("normalizes an untrusted return view to Active", async (): Promise<void> => {
    await expect(
      restoreFolderAction(createFolderForm("external"))
    ).rejects.toThrow(
      `NEXT_REDIRECT:/documents?folderId=${PARENT_FOLDER_ID}&message=Folder+restored.`
    )
  })
})

function createDocumentForm(): FormData {
  const formData = new FormData()
  formData.set("organizationId", "untrusted-organization")
  formData.set("documentId", DOCUMENT_ID)
  return formData
}

function createFolderForm(returnView: string): FormData {
  const formData = new FormData()
  formData.set("organizationId", "untrusted-organization")
  formData.set("folderId", FOLDER_ID)
  formData.set("returnFolderId", PARENT_FOLDER_ID)
  formData.set("returnView", returnView)
  return formData
}
