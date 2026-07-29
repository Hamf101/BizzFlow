import { describe, expect, it, vi } from "vitest"

import type { OrganizationRole } from "@/lib/permissions"
import {
  createDocumentRow,
  createMembershipRow,
  FakeSupabaseClient,
} from "@/services/document-service.test-support"
import {
  getEffectiveDocumentAccess,
  getEffectiveFolderAccess,
  requireDocumentAccess,
  requireFolderAccess,
} from "@/services/documents/access-service"
import type { DocumentServiceClient } from "@/services/documents/contracts"

type FakeAccessClientOptions = {
  documentAccess?: unknown
  folderAccess?: unknown
  rpcError?: Error | null
  membershipRole?: OrganizationRole | null
  membershipError?: Error | null
}

describe("document access lookups", () => {
  it("loads effective document access with tenant and actor scope", async () => {
    const { client, rpc } = createAccessClient({
      documentAccess: "viewer",
    })

    await expect(
      getEffectiveDocumentAccess(
        {
          organizationId: "org-1",
          documentId: "document-1",
          actorUserId: "user-1",
        },
        client
      )
    ).resolves.toBe("viewer")

    expect(rpc).toHaveBeenCalledWith("get_document_access_level", {
      target_org_id: "org-1",
      target_document_id: "document-1",
      target_actor_user_id: "user-1",
    })
  })

  it("loads effective folder access with tenant and actor scope", async () => {
    const { client, rpc } = createAccessClient({
      folderAccess: "contributor",
    })

    await expect(
      getEffectiveFolderAccess(
        {
          organizationId: "org-1",
          folderId: "folder-1",
          actorUserId: "user-1",
        },
        client
      )
    ).resolves.toBe("contributor")

    expect(rpc).toHaveBeenCalledWith("get_folder_access_level", {
      target_org_id: "org-1",
      target_folder_id: "folder-1",
      target_actor_user_id: "user-1",
    })
  })

  it("returns null when the actor has no effective access", async () => {
    const { client } = createAccessClient()

    await expect(
      getEffectiveDocumentAccess(
        {
          organizationId: "org-1",
          documentId: "private-document",
          actorUserId: "user-1",
        },
        client
      )
    ).resolves.toBeNull()
  })

  it("rejects unsupported access values from the database", async () => {
    const { client } = createAccessClient({
      documentAccess: "manager",
    })

    await expect(
      getEffectiveDocumentAccess(
        {
          organizationId: "org-1",
          documentId: "document-1",
          actorUserId: "user-1",
        },
        client
      )
    ).rejects.toMatchObject({
      message: "Database returned an unsupported document access level.",
      statusCode: 500,
    })
  })

  it("translates RPC failures into a document service error", async () => {
    const { client } = createAccessClient({
      rpcError: new Error("RPC unavailable"),
    })

    await expect(
      getEffectiveFolderAccess(
        {
          organizationId: "org-1",
          folderId: "folder-1",
          actorUserId: "user-1",
        },
        client
      )
    ).rejects.toMatchObject({
      message: "Unable to load folder access.",
      statusCode: 500,
    })
  })
})

describe("document access requirements", () => {
  it("allows contributor access when viewer access is required", async () => {
    const { client, from } = createAccessClient({
      documentAccess: "contributor",
    })

    await expect(
      requireDocumentAccess(
        {
          organizationId: "org-1",
          documentId: "document-1",
          actorUserId: "user-1",
          requiredAccess: "viewer",
          operation: "read",
        },
        client
      )
    ).resolves.toBe("contributor")

    expect(from).not.toHaveBeenCalled()
  })

  it("hides insufficient document access for reads", async () => {
    const { client } = createAccessClient({
      documentAccess: "viewer",
    })

    await expect(
      requireDocumentAccess(
        {
          organizationId: "org-1",
          documentId: "document-1",
          actorUserId: "user-1",
          requiredAccess: "contributor",
          operation: "read",
        },
        client
      )
    ).rejects.toMatchObject({
      message: "Document was not found.",
      statusCode: 404,
    })
  })

  it("hides missing folder access even for mutations", async () => {
    const { client } = createAccessClient({
      folderAccess: null,
    })

    await expect(
      requireFolderAccess(
        {
          organizationId: "org-1",
          folderId: "folder-1",
          actorUserId: "user-1",
          requiredAccess: "contributor",
          operation: "mutation",
        },
        client
      )
    ).rejects.toMatchObject({
      message: "Folder was not found.",
      statusCode: 404,
    })
  })

  it("returns forbidden when a visible folder has insufficient mutation access", async () => {
    const { client } = createAccessClient({
      folderAccess: "viewer",
    })

    await expect(
      requireFolderAccess(
        {
          organizationId: "org-1",
          folderId: "folder-1",
          actorUserId: "user-1",
          requiredAccess: "contributor",
          operation: "mutation",
        },
        client
      )
    ).rejects.toMatchObject({
      message: "You do not have sufficient access to modify this folder.",
      statusCode: 403,
    })
  })

  it("combines resource access with a supplied organization permission", async () => {
    const { client, from } = createAccessClient({
      documentAccess: "contributor",
      membershipRole: "staff",
    })

    await expect(
      requireDocumentAccess(
        {
          organizationId: "org-1",
          documentId: "document-1",
          actorUserId: "user-1",
          requiredAccess: "contributor",
          operation: "mutation",
          requiredOrganizationPermissionAction: "document_versions:create",
        },
        client
      )
    ).resolves.toBe("contributor")

    expect(from).toHaveBeenCalledWith("organization_memberships")
  })

  it("normalizes an organization-permission read denial to not found", async () => {
    const { client } = createAccessClient({
      folderAccess: "contributor",
      membershipRole: "external_reviewer",
    })

    await expect(
      requireFolderAccess(
        {
          organizationId: "org-1",
          folderId: "folder-1",
          actorUserId: "user-1",
          requiredAccess: "viewer",
          operation: "read",
          requiredOrganizationPermissionAction: "folders:manage",
        },
        client
      )
    ).rejects.toMatchObject({
      message: "Folder was not found.",
      statusCode: 404,
    })
  })

  it("preserves membership lookup failures instead of masking them as denials", async () => {
    const { client } = createAccessClient({
      documentAccess: "viewer",
      membershipError: new Error("Membership lookup unavailable"),
    })

    await expect(
      requireDocumentAccess(
        {
          organizationId: "org-1",
          documentId: "document-1",
          actorUserId: "user-1",
          requiredAccess: "viewer",
          operation: "read",
          requiredOrganizationPermissionAction: "documents:view",
        },
        client
      )
    ).rejects.toMatchObject({
      message: "Unable to load organization membership.",
      statusCode: 500,
    })
  })
})

describe("document access test adapter", () => {
  it("resolves a direct user grant for a non-creator", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [createDocumentRow({ created_by: "user-2" })],
      document_access_grants: [
        {
          id: "grant-1",
          org_id: "org-1",
          document_id: "document-1",
          user_id: "user-1",
          organization_role: null,
          access_level: "viewer",
        },
      ],
    })

    await expect(
      getEffectiveDocumentAccess(
        {
          organizationId: "org-1",
          documentId: "document-1",
          actorUserId: "user-1",
        },
        client as never
      )
    ).resolves.toBe("viewer")
  })

  it("inherits a role grant through the document folder ancestry", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      folders: [
        {
          id: "folder-root",
          org_id: "org-1",
          parent_folder_id: null,
          created_by: "user-2",
        },
        {
          id: "folder-child",
          org_id: "org-1",
          parent_folder_id: "folder-root",
          created_by: "user-2",
        },
      ],
      documents: [
        createDocumentRow({
          folder_id: "folder-child",
          created_by: "user-2",
        }),
      ],
      folder_access_grants: [
        {
          id: "grant-1",
          org_id: "org-1",
          folder_id: "folder-root",
          user_id: null,
          organization_role: "staff",
          access_level: "contributor",
        },
      ],
    })

    await expect(
      getEffectiveDocumentAccess(
        {
          organizationId: "org-1",
          documentId: "document-1",
          actorUserId: "user-1",
        },
        client as never
      )
    ).resolves.toBe("contributor")
  })
})

function createAccessClient(
  options: FakeAccessClientOptions = {}
): {
  client: DocumentServiceClient
  from: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
} {
  const {
    documentAccess = null,
    folderAccess = null,
    rpcError = null,
    membershipRole = "staff",
    membershipError = null,
  } = options
  const membership = membershipRole
    ? {
        id: "membership-1",
        org_id: "org-1",
        user_id: "user-1",
        role: membershipRole,
        status: "active",
        created_at: "2026-07-25T12:00:00.000Z",
        updated_at: "2026-07-25T12:00:00.000Z",
      }
    : null
  const maybeSingle = vi.fn().mockResolvedValue({
    data: membership,
    error: membershipError,
  })
  const queryBuilder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle,
  }

  queryBuilder.select.mockReturnValue(queryBuilder)
  queryBuilder.eq.mockReturnValue(queryBuilder)

  const from = vi.fn().mockReturnValue(queryBuilder)
  const rpc = vi.fn(
    async (
      functionName: string
    ): Promise<{ data: unknown; error: Error | null }> => ({
      data:
        functionName === "get_document_access_level"
          ? documentAccess
          : folderAccess,
      error: rpcError,
    })
  )

  return {
    client: { from, rpc } as unknown as DocumentServiceClient,
    from,
    rpc,
  }
}
