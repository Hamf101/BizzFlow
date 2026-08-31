import { beforeEach, describe, expect, it, vi } from "vitest"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import {
  archiveDocument,
  archiveFolder,
  createFolder,
  DocumentServiceError,
  requestDocumentPurge,
  requestFolderPurge,
  restoreDocument,
  restoreFolder,
  trashDocument,
  trashFolder,
} from "@/services/document-service"
import { createDocumentComment } from "@/services/document-comment-service"
import { getCurrentOrganizationContext } from "@/services/organization-service"

import {
  archiveDocumentAction,
  archiveFolderAction,
  createDocumentCommentAction,
  createFolderAction,
  requestDocumentPurgeAction,
  requestFolderPurgeAction,
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
    createFolder: vi.fn(),
    requestDocumentPurge: vi.fn(),
    requestFolderPurge: vi.fn(),
    restoreDocument: vi.fn(),
    restoreFolder: vi.fn(),
    trashDocument: vi.fn(),
    trashFolder: vi.fn(),
  }
})

vi.mock("@/services/organization-service", () => ({
  getCurrentOrganizationContext: vi.fn(),
}))

vi.mock("@/services/document-comment-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/document-comment-service")>()

  return {
    ...actual,
    createDocumentComment: vi.fn(),
  }
})

const ACTOR_USER_ID = "20000000-0000-4000-8000-000000000001"
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001"
const DOCUMENT_ID = "30000000-0000-4000-8000-000000000001"
const FOLDER_ID = "40000000-0000-4000-8000-000000000001"
const PARENT_FOLDER_ID = "50000000-0000-4000-8000-000000000001"
const PURGE_JOB_ID = "60000000-0000-4000-8000-000000000001"
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
  vi.mocked(createFolder).mockResolvedValue(undefined as never)
  vi.mocked(createDocumentComment).mockResolvedValue(undefined as never)
  vi.mocked(requestDocumentPurge).mockResolvedValue({
    jobId: PURGE_JOB_ID,
    lifecycleState: "purge_pending",
  })
  vi.mocked(requestFolderPurge).mockResolvedValue({
    jobId: PURGE_JOB_ID,
    lifecycleState: "purge_pending",
  })
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("document lifecycle actions", (): void => {
  it.each([
    {
      action: archiveDocumentAction,
      operation: archiveDocument,
      feedback: "resource_archived",
    },
    {
      action: restoreDocumentAction,
      operation: restoreDocument,
      feedback: "resource_restored",
    },
    {
      action: trashDocumentAction,
      operation: trashDocument,
      feedback: "resource_trashed",
    },
  ])(
    "derives document lifecycle tenant scope from authenticated context",
    async ({ action, operation, feedback }): Promise<void> => {
      await expect(action(createDocumentForm())).rejects.toThrow(
        `NEXT_REDIRECT:${DETAIL_PATH}?feedback=${feedback}`
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
      `NEXT_REDIRECT:${DETAIL_PATH}?feedback=refresh_required`
    )
    expect(redirectMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Document+is+already+in+Trash")
    )
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it.each([
    {
      action: archiveDocumentAction,
      feedback: "resource_archived",
    },
    {
      action: restoreDocumentAction,
      feedback: "resource_restored",
    },
    {
      action: trashDocumentAction,
      feedback: "resource_trashed",
    },
  ])(
    "returns a workspace row to the view it acted from",
    async ({ action, feedback }): Promise<void> => {
      await expect(
        action(createWorkspaceDocumentForm("archived"))
      ).rejects.toThrow(
        `NEXT_REDIRECT:/documents?view=archived&folderId=${PARENT_FOLDER_ID}&feedback=${feedback}`
      )
    }
  )

  it("normalizes an untrusted document return view to Active", async (): Promise<void> => {
    await expect(
      restoreDocumentAction(createWorkspaceDocumentForm("external"))
    ).rejects.toThrow(
      `NEXT_REDIRECT:/documents?folderId=${PARENT_FOLDER_ID}&feedback=resource_restored`
    )
  })

  it("keeps a workspace lifecycle failure on the workspace view", async (): Promise<void> => {
    vi.mocked(trashDocument).mockRejectedValue(
      new DocumentServiceError("Document is already in Trash.", 409)
    )

    await expect(
      trashDocumentAction(createWorkspaceDocumentForm("active"))
    ).rejects.toThrow(
      `NEXT_REDIRECT:/documents?folderId=${PARENT_FOLDER_ID}&feedback=refresh_required`
    )
  })

  it("preserves the exact document return path when authentication expires", async (): Promise<void> => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(
      new AuthenticationError("Sign in to continue.")
    )

    await expect(archiveDocumentAction(createDocumentForm())).rejects.toThrow(
      `NEXT_REDIRECT:/login?next=%2Fdocuments%2F${DOCUMENT_ID}`
    )
    expect(archiveDocument).not.toHaveBeenCalled()
  })
})

describe("folder lifecycle actions", (): void => {
  it.each([
    {
      action: archiveFolderAction,
      operation: archiveFolder,
      feedback: "resource_archived",
    },
    {
      action: restoreFolderAction,
      operation: restoreFolder,
      feedback: "resource_restored",
    },
    {
      action: trashFolderAction,
      operation: trashFolder,
      feedback: "resource_trashed",
    },
  ])(
    "derives folder lifecycle tenant scope and preserves the safe return path",
    async ({ action, operation, feedback }): Promise<void> => {
      await expect(action(createFolderForm("archived"))).rejects.toThrow(
        `NEXT_REDIRECT:/documents?view=archived&folderId=${PARENT_FOLDER_ID}&feedback=${feedback}`
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
      `NEXT_REDIRECT:/documents?folderId=${PARENT_FOLDER_ID}&feedback=resource_restored`
    )
  })
})

describe("document creation and collaboration actions", (): void => {
  it("creates a folder and reports a stable outcome on the current folder", async (): Promise<void> => {
    const formData = new FormData()
    formData.set("organizationId", ORGANIZATION_ID)
    formData.set("name", "Contracts")
    formData.set("parentFolderId", PARENT_FOLDER_ID)
    formData.set("returnFolderId", PARENT_FOLDER_ID)

    await expect(createFolderAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/documents?folderId=${PARENT_FOLDER_ID}&feedback=folder_created`
    )
    expect(createFolder).toHaveBeenCalledExactlyOnceWith({
      actorUserId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID,
      name: "Contracts",
      parentFolderId: PARENT_FOLDER_ID,
    })
  })

  it("adds a comment without reflecting a service error in the redirect", async (): Promise<void> => {
    vi.mocked(createDocumentComment).mockRejectedValue(
      new Error("private comment persistence detail")
    )
    const formData = new FormData()
    formData.set("organizationId", ORGANIZATION_ID)
    formData.set("documentId", DOCUMENT_ID)
    formData.set("body", "Please review this section.")

    await expect(createDocumentCommentAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:${DETAIL_PATH}?feedback=operation_failed`
    )
    expect(redirectMock).not.toHaveBeenCalledWith(
      expect.stringContaining("private+comment+persistence+detail")
    )
  })
})

describe("permanent deletion actions", (): void => {
  it("queues document deletion and keeps workspace route state", async (): Promise<void> => {
    const formData = createWorkspaceDocumentForm("trash")
    formData.set("confirmationTitle", "Client handbook")

    await expect(requestDocumentPurgeAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/documents?view=trash&folderId=${PARENT_FOLDER_ID}&feedback=deletion_queued`
    )
    expect(requestDocumentPurge).toHaveBeenCalledExactlyOnceWith({
      actorUserId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      confirmationTitle: "Client handbook",
    })
  })

  it("queues folder deletion with the same authoritative outcome", async (): Promise<void> => {
    const formData = createFolderForm("trash")
    formData.set("confirmationName", "Contracts")

    await expect(requestFolderPurgeAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/documents?view=trash&folderId=${PARENT_FOLDER_ID}&feedback=deletion_queued`
    )
  })
})

function createDocumentForm(): FormData {
  const formData = new FormData()
  formData.set("organizationId", "untrusted-organization")
  formData.set("documentId", DOCUMENT_ID)
  return formData
}

function createWorkspaceDocumentForm(returnView: string): FormData {
  const formData = createDocumentForm()
  formData.set("returnFolderId", PARENT_FOLDER_ID)
  formData.set("returnView", returnView)
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
