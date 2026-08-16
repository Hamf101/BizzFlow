import { afterEach, describe, expect, it, vi } from "vitest"

import type { OrganizationRole } from "@/lib/permissions"
import type {
  DocumentServiceDeps,
  FolderLifecycleInput,
  RestoreDocumentInput,
} from "@/services/documents/contracts"
import {
  archiveFolder,
  restoreDocument,
  restoreFolder,
  trashDocument,
  trashFolder,
} from "@/services/documents/lifecycle-service"
import type {
  DocumentFolder,
  DocumentLifecycleState,
  DocumentSummary,
} from "@/types/document"

type FakeRow = Record<string, unknown>
type LifecycleRpcName =
  | "restore_document"
  | "trash_document"
  | "archive_folder"
  | "restore_folder"
  | "trash_folder"

type FakeRpcResult = {
  data: unknown
  error: unknown
}

type FakeSupabaseError = {
  code?: string
  details?: string
  hint?: string
  message: string
}

type FakeLifecycleClientOptions = {
  document?: FakeRow | null
  folder?: FakeRow | null
  documentAccess?: unknown
  folderAccess?: unknown
  accessError?: unknown
  membershipRole?: OrganizationRole | null
  membershipError?: unknown
  documentPurgeAfter?: string | null
  folderPurgeAfter?: string | null
  lifecycleResults?: Partial<Record<LifecycleRpcName, FakeRpcResult>>
}

type DocumentLifecycleOperation = (
  input: RestoreDocumentInput,
  deps?: DocumentServiceDeps
) => Promise<DocumentSummary>

type FolderLifecycleOperation = (
  input: FolderLifecycleInput,
  deps?: DocumentServiceDeps
) => Promise<DocumentFolder>

const documentInput: RestoreDocumentInput = {
  actorUserId: "user-1",
  organizationId: "org-1",
  documentId: "document-1",
}

const folderInput: FolderLifecycleInput = {
  actorUserId: "user-1",
  organizationId: "org-1",
  folderId: "folder-1",
}

afterEach((): void => {
  vi.restoreAllMocks()
})

describe("document lifecycle transitions", (): void => {
  it("restores an archived document after scoped access and permission checks", async (): Promise<void> => {
    const client = new FakeLifecycleClient({
      document: createDocumentRow("archived"),
    })
    const deps = createLifecycleDeps(client)

    const document = await restoreDocument(documentInput, deps)

    expect(document).toMatchObject({
      id: "document-1",
      organizationId: "org-1",
      lifecycleState: "active",
      archivedAt: null,
    })
    expect(client.rpc).toHaveBeenNthCalledWith(
      1,
      "get_document_access_level",
      {
        target_org_id: "org-1",
        target_document_id: "document-1",
        target_actor_user_id: "user-1",
      }
    )
    expect(client.rpc).toHaveBeenNthCalledWith(2, "restore_document", {
      target_org_id: "org-1",
      target_document_id: "document-1",
      target_actor_user_id: "user-1",
    })
    expect(deps.createId).not.toHaveBeenCalled()
    expect(deps.recordAuditLog).toHaveBeenCalledWith({
      organizationId: "org-1",
      actorUserId: "user-1",
      action: "document.restored",
      targetType: "document",
      targetId: "document-1",
      metadata: {
        title: "Lifecycle contract",
        lifecycleState: "active",
      },
    })
  })

  it("moves a document to Trash with one reversible operation identifier", async (): Promise<void> => {
    const client = new FakeLifecycleClient({
      document: createDocumentRow("active"),
      documentPurgeAfter: "2026-08-28T12:00:00.000Z",
    })
    const deps = createLifecycleDeps(client, ["trash-operation-1"])

    const document = await trashDocument(documentInput, deps)

    expect(document).toMatchObject({
      lifecycleState: "trashed",
      preTrashLifecycleState: "active",
      trashOperationId: "trash-operation-1",
      purgeAfter: "2026-08-28T12:00:00.000Z",
    })
    expect(deps.createId).toHaveBeenCalledTimes(1)
    expect(client.rpc).toHaveBeenNthCalledWith(2, "trash_document", {
      target_org_id: "org-1",
      target_document_id: "document-1",
      target_actor_user_id: "user-1",
      target_trash_operation_id: "trash-operation-1",
    })
    expect(deps.recordAuditLog).toHaveBeenCalledWith({
      organizationId: "org-1",
      actorUserId: "user-1",
      action: "document.trashed",
      targetType: "document",
      targetId: "document-1",
      metadata: {
        title: "Lifecycle contract",
        purgeAfter: "2026-08-28T12:00:00.000Z",
        retentionProtected: false,
        trashOperationId: "trash-operation-1",
      },
    })
  })

  it("records retention protection when a trashed document has no purge deadline", async (): Promise<void> => {
    const client = new FakeLifecycleClient({
      document: createDocumentRow("archived"),
      documentPurgeAfter: null,
    })
    const deps = createLifecycleDeps(client, ["protected-trash-operation"])

    const document = await trashDocument(documentInput, deps)

    expect(document).toMatchObject({
      lifecycleState: "trashed",
      preTrashLifecycleState: "archived",
      purgeAfter: null,
    })
    expect(deps.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          retentionProtected: true,
          trashOperationId: "protected-trash-operation",
        }),
      })
    )
  })

  it("keeps a successful document transition when best-effort audit recording fails", async (): Promise<void> => {
    const client = new FakeLifecycleClient({
      document: createDocumentRow("archived"),
    })
    const deps = createLifecycleDeps(client)
    const auditError = new Error("Audit service unavailable")
    deps.recordAuditLog = vi
      .fn(
        async (): Promise<void> => {
          throw auditError
        }
      )
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(restoreDocument(documentInput, deps)).resolves.toMatchObject({
      lifecycleState: "active",
    })
    expect(warning).toHaveBeenCalledWith(
      "document_audit_log_failed",
      expect.objectContaining({
        organizationId: "org-1",
        actorUserId: "user-1",
        action: "document.restored",
        reason: "Audit service unavailable",
      })
    )
  })

  it.each([
    {
      label: "an already active document",
      operation: restoreDocument as DocumentLifecycleOperation,
      state: "active" as const,
      message: "Document is already active.",
    },
    {
      label: "a purge-pending document restore",
      operation: restoreDocument as DocumentLifecycleOperation,
      state: "purge_pending" as const,
      message: "A purge-pending document cannot be restored.",
    },
    {
      label: "a document already in Trash",
      operation: trashDocument as DocumentLifecycleOperation,
      state: "trashed" as const,
      message: "Document is already in Trash.",
    },
    {
      label: "a purge-pending document trash",
      operation: trashDocument as DocumentLifecycleOperation,
      state: "purge_pending" as const,
      message: "A purge-pending document cannot be moved to Trash.",
    },
  ])(
    "rejects $label before calling the lifecycle RPC",
    async ({
      operation,
      state,
      message,
    }): Promise<void> => {
      const client = new FakeLifecycleClient({
        document: createDocumentRow(state),
      })
      const deps = createLifecycleDeps(client)

      await expect(operation(documentInput, deps)).rejects.toMatchObject({
        message,
        statusCode: 409,
      })
      expect(getLifecycleCalls(client)).toEqual([])
      expect(deps.createId).not.toHaveBeenCalled()
      expect(deps.recordAuditLog).not.toHaveBeenCalled()
    }
  )
})

describe("document lifecycle authorization", (): void => {
  it("hides a document when the actor has no effective access", async (): Promise<void> => {
    const client = new FakeLifecycleClient({
      document: createDocumentRow("archived"),
      documentAccess: null,
    })
    const deps = createLifecycleDeps(client)

    await expect(restoreDocument(documentInput, deps)).rejects.toMatchObject({
      message: "Document was not found.",
      statusCode: 404,
    })
    expect(client.from).not.toHaveBeenCalled()
    expect(getLifecycleCalls(client)).toEqual([])
    expect(deps.recordAuditLog).not.toHaveBeenCalled()
  })

  it("rejects viewer access before checking organization permission", async (): Promise<void> => {
    const client = new FakeLifecycleClient({
      document: createDocumentRow("active"),
      documentAccess: "viewer",
    })
    const deps = createLifecycleDeps(client)

    await expect(trashDocument(documentInput, deps)).rejects.toMatchObject({
      message:
        "You do not have sufficient access to modify this document.",
      statusCode: 403,
    })
    expect(client.from).not.toHaveBeenCalled()
    expect(getLifecycleCalls(client)).toEqual([])
  })

  it("requires the documents:archive organization permission in addition to contributor access", async (): Promise<void> => {
    const client = new FakeLifecycleClient({
      document: createDocumentRow("archived"),
      documentAccess: "contributor",
      membershipRole: "staff",
    })
    const deps = createLifecycleDeps(client)

    await expect(restoreDocument(documentInput, deps)).rejects.toMatchObject({
      message:
        "You do not have sufficient access to modify this document.",
      statusCode: 403,
    })
    expect(client.from).toHaveBeenCalledWith("organization_memberships")
    expect(getLifecycleCalls(client)).toEqual([])
  })

  it("preserves document access RPC failures", async (): Promise<void> => {
    const client = new FakeLifecycleClient({
      document: createDocumentRow("archived"),
      accessError: new Error("Access RPC unavailable"),
    })
    const deps = createLifecycleDeps(client)

    await expect(restoreDocument(documentInput, deps)).rejects.toMatchObject({
      message: "Unable to load document access.",
      statusCode: 500,
    })
    expect(getLifecycleCalls(client)).toEqual([])
    expect(deps.recordAuditLog).not.toHaveBeenCalled()
  })

  it("preserves organization membership lookup failures", async (): Promise<void> => {
    const client = new FakeLifecycleClient({
      document: createDocumentRow("archived"),
      membershipError: new Error("Membership lookup unavailable"),
    })
    const deps = createLifecycleDeps(client)

    await expect(restoreDocument(documentInput, deps)).rejects.toMatchObject({
      message: "Unable to load organization membership.",
      statusCode: 500,
    })
    expect(getLifecycleCalls(client)).toEqual([])
  })
})

describe("document lifecycle RPC failures", (): void => {
  it.each([
    {
      label: "missing resource",
      result: rpcFailure("P0002", "Document not found."),
      expectedMessage: "Document was not found.",
      expectedStatus: 404,
    },
    {
      label: "database access denial",
      result: rpcFailure(
        "42501",
        "Contributor access and a manager role are required."
      ),
      expectedMessage:
        "You do not have sufficient access for this lifecycle change.",
      expectedStatus: 403,
    },
    {
      label: "invalid lifecycle state",
      result: rpcFailure(
        "P0001",
        "Purge-pending documents cannot be restored."
      ),
      expectedMessage: "Unable to restore document.",
      expectedStatus: 409,
    },
    {
      label: "invalid restore metadata",
      result: rpcFailure(
        "23514",
        "Document restore metadata is invalid."
      ),
      expectedMessage: "Unable to restore document.",
      expectedStatus: 409,
    },
    {
      label: "ordinary database failure",
      result: {
        data: null,
        error: new Error("Database unavailable"),
      },
      expectedMessage: "Unable to restore document.",
      expectedStatus: 500,
    },
  ])(
    "normalizes a $label without writing an audit event",
    async ({
      result,
      expectedMessage,
      expectedStatus,
    }): Promise<void> => {
      const client = new FakeLifecycleClient({
        document: createDocumentRow("archived"),
        lifecycleResults: {
          restore_document: result,
        },
      })
      const deps = createLifecycleDeps(client)

      await expect(restoreDocument(documentInput, deps)).rejects.toMatchObject({
        message: expectedMessage,
        statusCode: expectedStatus,
      })
      expect(deps.recordAuditLog).not.toHaveBeenCalled()
    }
  )

  it("treats an unchanged RPC result as a concurrent lifecycle conflict", async (): Promise<void> => {
    const client = new FakeLifecycleClient({
      document: createDocumentRow("archived"),
      lifecycleResults: {
        restore_document: {
          data: false,
          error: null,
        },
      },
    })
    const deps = createLifecycleDeps(client)

    await expect(restoreDocument(documentInput, deps)).rejects.toMatchObject({
      message: "Document is already restored.",
      statusCode: 409,
    })
    expect(deps.recordAuditLog).not.toHaveBeenCalled()
  })

  it("does not disguise infrastructure permission failures as actor denials", async (): Promise<void> => {
    const client = new FakeLifecycleClient({
      document: createDocumentRow("archived"),
      lifecycleResults: {
        restore_document: rpcFailure(
          "42501",
          "permission denied for table documents"
        ),
      },
    })
    const deps = createLifecycleDeps(client)

    await expect(restoreDocument(documentInput, deps)).rejects.toMatchObject({
      message:
        "Supabase table permissions are incomplete. Apply the latest migrations.",
      statusCode: 500,
    })
  })
})

describe("folder lifecycle transitions", (): void => {
  it.each([
    {
      label: "archives",
      operation: archiveFolder as FolderLifecycleOperation,
      initialState: "active" as const,
      rpcName: "archive_folder" as const,
      expectedState: "archived" as const,
      expectedArgs: {
        target_org_id: "org-1",
        target_folder_id: "folder-1",
        target_actor_user_id: "user-1",
      },
    },
    {
      label: "restores",
      operation: restoreFolder as FolderLifecycleOperation,
      initialState: "archived" as const,
      rpcName: "restore_folder" as const,
      expectedState: "active" as const,
      expectedArgs: {
        target_org_id: "org-1",
        target_folder_id: "folder-1",
        target_actor_user_id: "user-1",
      },
    },
    {
      label: "moves to Trash",
      operation: trashFolder as FolderLifecycleOperation,
      initialState: "active" as const,
      rpcName: "trash_folder" as const,
      expectedState: "trashed" as const,
      expectedArgs: {
        target_org_id: "org-1",
        target_folder_id: "folder-1",
        target_actor_user_id: "user-1",
        target_trash_operation_id: "folder-trash-operation",
      },
    },
  ])(
    "$label a folder through the atomic database RPC",
    async ({
      operation,
      initialState,
      rpcName,
      expectedState,
      expectedArgs,
    }): Promise<void> => {
      const client = new FakeLifecycleClient({
        folder: createFolderRow(initialState),
      })
      const deps = createLifecycleDeps(client, [
        "folder-trash-operation",
      ])

      const folder = await operation(folderInput, deps)

      expect(folder).toMatchObject({
        id: "folder-1",
        organizationId: "org-1",
        lifecycleState: expectedState,
      })
      expect(client.rpc).toHaveBeenNthCalledWith(
        1,
        "get_folder_access_level",
        {
          target_org_id: "org-1",
          target_folder_id: "folder-1",
          target_actor_user_id: "user-1",
        }
      )
      expect(client.rpc).toHaveBeenNthCalledWith(
        2,
        rpcName,
        expectedArgs
      )

      if (rpcName === "trash_folder") {
        expect(deps.createId).toHaveBeenCalledTimes(1)
        expect(folder).toMatchObject({
          preTrashLifecycleState: "active",
          trashOperationId: "folder-trash-operation",
        })
      } else {
        expect(deps.createId).not.toHaveBeenCalled()
      }

      // Folder RPCs persist their own chained audit row transactionally.
      expect(deps.recordAuditLog).not.toHaveBeenCalled()
    }
  )

  it.each([
    {
      label: "archive of an archived folder",
      operation: archiveFolder as FolderLifecycleOperation,
      state: "archived" as const,
      message: "Only active folders can be archived.",
    },
    {
      label: "restore of an active folder",
      operation: restoreFolder as FolderLifecycleOperation,
      state: "active" as const,
      message: "Folder is already active.",
    },
    {
      label: "restore of a purge-pending folder",
      operation: restoreFolder as FolderLifecycleOperation,
      state: "purge_pending" as const,
      message: "A purge-pending folder cannot be restored.",
    },
    {
      label: "trash of an already trashed folder",
      operation: trashFolder as FolderLifecycleOperation,
      state: "trashed" as const,
      message: "Folder is already in Trash.",
    },
    {
      label: "trash of a purge-pending folder",
      operation: trashFolder as FolderLifecycleOperation,
      state: "purge_pending" as const,
      message: "A purge-pending folder cannot be moved to Trash.",
    },
  ])(
    "rejects $label before calling the lifecycle RPC",
    async ({
      operation,
      state,
      message,
    }): Promise<void> => {
      const client = new FakeLifecycleClient({
        folder: createFolderRow(state),
      })
      const deps = createLifecycleDeps(client)

      await expect(operation(folderInput, deps)).rejects.toMatchObject({
        message,
        statusCode: 409,
      })
      expect(getLifecycleCalls(client)).toEqual([])
      expect(deps.createId).not.toHaveBeenCalled()
      expect(deps.recordAuditLog).not.toHaveBeenCalled()
    }
  )
})

describe("folder lifecycle authorization and RPC failures", (): void => {
  it("hides a folder when the actor has no effective access", async (): Promise<void> => {
    const client = new FakeLifecycleClient({
      folder: createFolderRow("active"),
      folderAccess: null,
    })
    const deps = createLifecycleDeps(client)

    await expect(archiveFolder(folderInput, deps)).rejects.toMatchObject({
      message: "Folder was not found.",
      statusCode: 404,
    })
    expect(getLifecycleCalls(client)).toEqual([])
  })

  it("requires contributor access for folder lifecycle mutations", async (): Promise<void> => {
    const client = new FakeLifecycleClient({
      folder: createFolderRow("active"),
      folderAccess: "viewer",
    })
    const deps = createLifecycleDeps(client)

    await expect(archiveFolder(folderInput, deps)).rejects.toMatchObject({
      message: "You do not have sufficient access to modify this folder.",
      statusCode: 403,
    })
    expect(getLifecycleCalls(client)).toEqual([])
  })

  it("requires the folders:manage organization permission", async (): Promise<void> => {
    const client = new FakeLifecycleClient({
      folder: createFolderRow("active"),
      folderAccess: "contributor",
      membershipRole: "staff",
    })
    const deps = createLifecycleDeps(client)

    await expect(archiveFolder(folderInput, deps)).rejects.toMatchObject({
      message: "You do not have sufficient access to modify this folder.",
      statusCode: 403,
    })
    expect(getLifecycleCalls(client)).toEqual([])
  })

  it.each([
    {
      label: "missing folder",
      result: rpcFailure("P0002", "Folder not found."),
      expectedMessage: "Folder was not found.",
      expectedStatus: 404,
    },
    {
      label: "database access denial",
      result: rpcFailure(
        "42501",
        "Contributor access and a manager role are required."
      ),
      expectedMessage:
        "You do not have sufficient access for this lifecycle change.",
      expectedStatus: 403,
    },
    {
      label: "invalid lifecycle state",
      result: rpcFailure("P0001", "Only active folders may be archived."),
      expectedMessage: "Unable to archive folder.",
      expectedStatus: 409,
    },
    {
      label: "ordinary database failure",
      result: {
        data: null,
        error: new Error("Database unavailable"),
      },
      expectedMessage: "Unable to archive folder.",
      expectedStatus: 500,
    },
  ])(
    "normalizes a $label",
    async ({
      result,
      expectedMessage,
      expectedStatus,
    }): Promise<void> => {
      const client = new FakeLifecycleClient({
        folder: createFolderRow("active"),
        lifecycleResults: {
          archive_folder: result,
        },
      })
      const deps = createLifecycleDeps(client)

      await expect(archiveFolder(folderInput, deps)).rejects.toMatchObject({
        message: expectedMessage,
        statusCode: expectedStatus,
      })
      expect(deps.recordAuditLog).not.toHaveBeenCalled()
    }
  )

  it("treats an unchanged folder RPC result as a concurrent conflict", async (): Promise<void> => {
    const client = new FakeLifecycleClient({
      folder: createFolderRow("active"),
      lifecycleResults: {
        archive_folder: {
          data: false,
          error: null,
        },
      },
    })
    const deps = createLifecycleDeps(client)

    await expect(archiveFolder(folderInput, deps)).rejects.toMatchObject({
      message: "Folder is already archived.",
      statusCode: 409,
    })
    expect(deps.recordAuditLog).not.toHaveBeenCalled()
  })

  it("preserves folder access RPC failures", async (): Promise<void> => {
    const client = new FakeLifecycleClient({
      folder: createFolderRow("active"),
      accessError: new Error("Access RPC unavailable"),
    })
    const deps = createLifecycleDeps(client)

    await expect(archiveFolder(folderInput, deps)).rejects.toMatchObject({
      message: "Unable to load folder access.",
      statusCode: 500,
    })
    expect(getLifecycleCalls(client)).toEqual([])
  })
})

class FakeLifecycleClient {
  readonly rpc: ReturnType<typeof vi.fn>
  readonly from: ReturnType<typeof vi.fn>
  private readonly options: FakeLifecycleClientOptions
  private document: FakeRow | null
  private folder: FakeRow | null

  constructor(options: FakeLifecycleClientOptions = {}) {
    this.options = options
    this.document =
      options.document === undefined
        ? createDocumentRow("active")
        : options.document
    this.folder =
      options.folder === undefined
        ? createFolderRow("active")
        : options.folder
    this.rpc = vi.fn(
      async (
        functionName: string,
        args: Record<string, unknown>
      ): Promise<FakeRpcResult> => this.executeRpc(functionName, args)
    )
    this.from = vi.fn(
      (tableName: string): FakeMaybeSingleQuery =>
        new FakeMaybeSingleQuery(
          this.getRows(tableName),
          this.getQueryError(tableName)
        )
    )
  }

  private async executeRpc(
    functionName: string,
    args: Record<string, unknown>
  ): Promise<FakeRpcResult> {
    if (functionName === "get_document_access_level") {
      return {
        data:
          this.options.documentAccess === undefined
            ? "contributor"
            : this.options.documentAccess,
        error: this.options.accessError ?? null,
      }
    }

    if (functionName === "get_folder_access_level") {
      return {
        data:
          this.options.folderAccess === undefined
            ? "contributor"
            : this.options.folderAccess,
        error: this.options.accessError ?? null,
      }
    }

    if (!isLifecycleRpcName(functionName)) {
      return {
        data: null,
        error: new Error(`Unsupported RPC: ${functionName}`),
      }
    }

    const result = this.options.lifecycleResults?.[functionName] ?? {
      data: true,
      error: null,
    }

    if (result.error === null && result.data === true) {
      this.applyLifecycleTransition(functionName, args)
    }

    return result
  }

  private applyLifecycleTransition(
    functionName: LifecycleRpcName,
    args: Record<string, unknown>
  ): void {
    if (functionName === "restore_document" && this.document) {
      restoreRow(this.document, args.target_actor_user_id)
      return
    }

    if (functionName === "trash_document" && this.document) {
      trashRow(
        this.document,
        args.target_actor_user_id,
        args.target_trash_operation_id,
        this.options.documentPurgeAfter === undefined
          ? "2026-08-28T12:00:00.000Z"
          : this.options.documentPurgeAfter
      )
      return
    }

    if (functionName === "archive_folder" && this.folder) {
      this.folder.lifecycle_state = "archived"
      this.folder.archived_by = args.target_actor_user_id
      this.folder.archived_at = "2026-07-29T12:00:00.000Z"
      this.folder.updated_by = args.target_actor_user_id
      return
    }

    if (functionName === "restore_folder" && this.folder) {
      restoreRow(this.folder, args.target_actor_user_id)
      return
    }

    if (functionName === "trash_folder" && this.folder) {
      trashRow(
        this.folder,
        args.target_actor_user_id,
        args.target_trash_operation_id,
        this.options.folderPurgeAfter === undefined
          ? "2026-08-28T12:00:00.000Z"
          : this.options.folderPurgeAfter
      )
    }
  }

  private getRows(tableName: string): FakeRow[] {
    if (tableName === "documents") {
      return this.document ? [this.document] : []
    }

    if (tableName === "folders") {
      return this.folder ? [this.folder] : []
    }

    if (tableName === "organization_memberships") {
      const membershipRole =
        this.options.membershipRole === undefined
          ? "manager"
          : this.options.membershipRole
      return membershipRole ? [createMembershipRow(membershipRole)] : []
    }

    return []
  }

  private getQueryError(tableName: string): unknown {
    return tableName === "organization_memberships"
      ? (this.options.membershipError ?? null)
      : null
  }
}

class FakeMaybeSingleQuery {
  private readonly filters: Array<(row: FakeRow) => boolean> = []

  constructor(
    private readonly rows: FakeRow[],
    private readonly error: unknown
  ) {}

  select(columns: string): FakeMaybeSingleQuery {
    void columns
    return this
  }

  eq(column: string, value: unknown): FakeMaybeSingleQuery {
    this.filters.push((row: FakeRow): boolean => row[column] === value)
    return this
  }

  async maybeSingle(): Promise<FakeRpcResult> {
    if (this.error) {
      return {
        data: null,
        error: this.error,
      }
    }

    const matchingRows = this.rows.filter((row: FakeRow): boolean =>
      this.filters.every(
        (filter: (candidate: FakeRow) => boolean): boolean =>
          filter(row)
      )
    )

    if (matchingRows.length > 1) {
      return {
        data: null,
        error: new Error("Expected zero or one row."),
      }
    }

    return {
      data: matchingRows[0] ?? null,
      error: null,
    }
  }
}

function createLifecycleDeps(
  client: FakeLifecycleClient,
  ids: string[] = []
): DocumentServiceDeps {
  const idQueue = [...ids]

  return {
    client: client as never,
    createId: vi.fn(
      (): string => idQueue.shift() ?? "generated-lifecycle-id"
    ),
    recordAuditLog: vi.fn(async (): Promise<void> => {}),
  }
}

function createDocumentRow(
  lifecycleState: DocumentLifecycleState,
  overrides: FakeRow = {}
): FakeRow {
  const archived =
    lifecycleState === "archived" ||
    lifecycleState === "trashed" ||
    lifecycleState === "purge_pending"
  const trashed =
    lifecycleState === "trashed" ||
    lifecycleState === "purge_pending"

  return {
    id: "document-1",
    org_id: "org-1",
    folder_id: null,
    title: "Lifecycle contract",
    description: null,
    current_version_id: "version-1",
    source_kind: "upload",
    template_id: null,
    template_revision: null,
    lifecycle_state: lifecycleState,
    created_by: "user-1",
    updated_by: "user-1",
    archived_by: archived ? "user-1" : null,
    archived_at: archived ? "2026-07-28T12:00:00.000Z" : null,
    trashed_by: trashed ? "user-1" : null,
    trashed_at: trashed ? "2026-07-29T11:00:00.000Z" : null,
    purge_after: trashed ? "2026-08-28T11:00:00.000Z" : null,
    pre_trash_lifecycle_state: trashed ? "active" : null,
    trash_operation_id: trashed ? "previous-trash-operation" : null,
    created_at: "2026-07-28T10:00:00.000Z",
    updated_at: "2026-07-29T11:00:00.000Z",
    ...overrides,
  }
}

function createFolderRow(
  lifecycleState: DocumentLifecycleState,
  overrides: FakeRow = {}
): FakeRow {
  const archived =
    lifecycleState === "archived" ||
    lifecycleState === "trashed" ||
    lifecycleState === "purge_pending"
  const trashed =
    lifecycleState === "trashed" ||
    lifecycleState === "purge_pending"

  return {
    id: "folder-1",
    org_id: "org-1",
    parent_folder_id: null,
    name: "Lifecycle folder",
    lifecycle_state: lifecycleState,
    created_by: "user-1",
    updated_by: "user-1",
    archived_by: archived ? "user-1" : null,
    archived_at: archived ? "2026-07-28T12:00:00.000Z" : null,
    trashed_by: trashed ? "user-1" : null,
    trashed_at: trashed ? "2026-07-29T11:00:00.000Z" : null,
    purge_after: trashed ? "2026-08-28T11:00:00.000Z" : null,
    pre_trash_lifecycle_state: trashed ? "active" : null,
    trash_operation_id: trashed ? "previous-trash-operation" : null,
    created_at: "2026-07-28T10:00:00.000Z",
    updated_at: "2026-07-29T11:00:00.000Z",
    ...overrides,
  }
}

function createMembershipRow(role: OrganizationRole): FakeRow {
  return {
    id: "membership-1",
    org_id: "org-1",
    user_id: "user-1",
    role,
    status: "active",
    created_at: "2026-07-28T10:00:00.000Z",
    updated_at: "2026-07-28T10:00:00.000Z",
  }
}

function restoreRow(row: FakeRow, actorUserId: unknown): void {
  row.lifecycle_state =
    row.lifecycle_state === "archived"
      ? "active"
      : (row.pre_trash_lifecycle_state ?? "active")
  row.archived_by =
    row.lifecycle_state === "active" ? null : row.archived_by
  row.archived_at =
    row.lifecycle_state === "active" ? null : row.archived_at
  row.trashed_by = null
  row.trashed_at = null
  row.purge_after = null
  row.pre_trash_lifecycle_state = null
  row.trash_operation_id = null
  row.updated_by = actorUserId
  row.updated_at = "2026-07-29T12:00:00.000Z"
}

function trashRow(
  row: FakeRow,
  actorUserId: unknown,
  trashOperationId: unknown,
  purgeAfter: string | null
): void {
  const previousState = row.lifecycle_state

  row.lifecycle_state = "trashed"
  row.archived_by = row.archived_by ?? actorUserId
  row.archived_at =
    row.archived_at ?? "2026-07-29T12:00:00.000Z"
  row.trashed_by = actorUserId
  row.trashed_at = "2026-07-29T12:00:00.000Z"
  row.purge_after = purgeAfter
  row.pre_trash_lifecycle_state = previousState
  row.trash_operation_id = trashOperationId
  row.updated_by = actorUserId
  row.updated_at = "2026-07-29T12:00:00.000Z"
}

function rpcFailure(
  code: string,
  message: string
): FakeRpcResult {
  const error: FakeSupabaseError = {
    code,
    message,
  }

  return {
    data: null,
    error,
  }
}

function isLifecycleRpcName(value: string): value is LifecycleRpcName {
  return (
    value === "restore_document" ||
    value === "trash_document" ||
    value === "archive_folder" ||
    value === "restore_folder" ||
    value === "trash_folder"
  )
}

function getLifecycleCalls(
  client: FakeLifecycleClient
): unknown[][] {
  return client.rpc.mock.calls.filter(
    (call: unknown[]): boolean =>
      typeof call[0] === "string" && isLifecycleRpcName(call[0])
  )
}
