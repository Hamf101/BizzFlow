import { vi } from "vitest"

import type { OrganizationRole } from "@/lib/permissions"
import type { DocumentServiceDeps } from "@/services/document-service"
import type { DocumentAccessLevel } from "@/types/document"

export type FakeRow = Record<string, unknown>

type FakeTableName =
  | "organization_memberships"
  | "folders"
  | "documents"
  | "folder_access_grants"
  | "document_access_grants"
  | "document_versions"
  | "document_activity_events"
  | "audit_logs"

type FakeTables = Record<FakeTableName, FakeRow[]>

/**
 * In-memory Supabase client used by the document service tests.
 */
export class FakeSupabaseClient {
  readonly tables: FakeTables

  constructor(seed: Partial<FakeTables> = {}) {
    this.tables = {
      organization_memberships: seed.organization_memberships ?? [],
      folders: seed.folders ?? [],
      documents: seed.documents ?? [],
      folder_access_grants: seed.folder_access_grants ?? [],
      document_access_grants: seed.document_access_grants ?? [],
      document_versions: seed.document_versions ?? [],
      document_activity_events: seed.document_activity_events ?? [],
      audit_logs: seed.audit_logs ?? [],
    }
  }

  /**
   * Starts an in-memory query for a supported document table.
   *
   * @param tableName - Table to query.
   * @returns Chainable fake query builder.
   */
  from(tableName: FakeTableName): FakeQueryBuilder {
    return new FakeQueryBuilder(this, tableName)
  }

  /**
   * Emulates the document lifecycle RPCs used by the service layer.
   *
   * @param functionName - RPC function to execute.
   * @param args - RPC arguments.
   * @returns Fake Supabase RPC response.
   */
  async rpc(
    functionName:
      | "archive_document"
      | "create_pending_document_version"
      | "complete_document_version"
      | "get_document_access_level"
      | "get_folder_access_level",
    args: Record<string, unknown>
  ): Promise<{ data: string | boolean | null; error: Error | null }> {
    if (functionName === "get_document_access_level") {
      return {
        data: this.getEffectiveDocumentAccess(
          String(args.target_org_id),
          String(args.target_document_id),
          String(args.target_actor_user_id)
        ),
        error: null,
      }
    }

    if (functionName === "get_folder_access_level") {
      return {
        data: this.getEffectiveFolderAccess(
          String(args.target_org_id),
          String(args.target_folder_id),
          String(args.target_actor_user_id)
        ),
        error: null,
      }
    }

    if (functionName === "create_pending_document_version") {
      const document = this.tables.documents.find(
        (row: FakeRow): boolean =>
          row.id === args.target_document_id && row.org_id === args.target_org_id
      )

      if (!document || document.archived_at) {
        return { data: null, error: new Error("Document cannot be replaced.") }
      }

      const versionNumbers = this.tables.document_versions
        .filter(
          (row: FakeRow): boolean =>
            row.document_id === args.target_document_id &&
            row.org_id === args.target_org_id
        )
        .map((row: FakeRow): number => Number(row.version_number))
      const versionNumber = Math.max(0, ...versionNumbers) + 1
      const versionId = String(args.target_version_id)

      this.tables.document_versions.push({
        id: versionId,
        org_id: args.target_org_id,
        document_id: args.target_document_id,
        version_number: versionNumber,
        status: "upload_pending",
        storage_key: args.target_storage_key,
        original_filename: args.target_original_filename,
        content_type: args.target_content_type,
        byte_size: args.target_byte_size,
        checksum_sha256: args.target_checksum_sha256,
        uploaded_by: args.target_uploaded_by,
        created_at: "2026-07-09T12:00:00.000Z",
        updated_at: "2026-07-09T12:00:00.000Z",
      })

      return { data: versionId, error: null }
    }

    const document = this.tables.documents.find(
      (row: FakeRow): boolean =>
        row.id === args.target_document_id && row.org_id === args.target_org_id
    )

    if (functionName === "archive_document") {
      if (!document) {
        return { data: false, error: new Error("Document not found.") }
      }

      if (document.archived_at) {
        return { data: false, error: null }
      }

      document.archived_at = "2026-07-09T12:00:00.000Z"
      document.archived_by = args.target_actor_user_id
      document.lifecycle_state = "archived"
      document.updated_by = args.target_actor_user_id
      document.updated_at = "2026-07-09T12:00:00.000Z"
      this.tables.document_activity_events.push({
        id: "activity-archive-1",
        org_id: args.target_org_id,
        document_id: args.target_document_id,
        actor_user_id: args.target_actor_user_id,
        event_type: "document.archived",
        metadata: {},
        created_at: "2026-07-09T12:00:00.000Z",
      })

      return { data: true, error: null }
    }

    const version = this.tables.document_versions.find(
      (row: FakeRow): boolean =>
        row.id === args.target_version_id &&
        row.document_id === args.target_document_id &&
        row.org_id === args.target_org_id
    )

    if (!document || !version) {
      return { data: false, error: new Error("Version cannot be completed.") }
    }

    if (version.status === "available") {
      return { data: true, error: null }
    }

    if (version.status !== "upload_pending") {
      return { data: false, error: new Error("Version cannot be completed.") }
    }

    version.status = "available"
    version.updated_at = "2026-07-09T12:00:00.000Z"
    this.tables.document_activity_events.push({
      id: `activity-version-${String(version.id)}`,
      org_id: args.target_org_id,
      document_id: args.target_document_id,
      actor_user_id: args.target_actor_user_id,
      event_type:
        Number(version.version_number) === 1
          ? "document.uploaded"
          : "document.replaced",
      metadata: { versionId: version.id },
      created_at: "2026-07-09T12:00:00.000Z",
    })

    const currentVersion = this.tables.document_versions.find(
      (row: FakeRow): boolean => row.id === document.current_version_id
    )

    if (
      !currentVersion ||
      Number(version.version_number) > Number(currentVersion.version_number)
    ) {
      document.current_version_id = version.id
      document.updated_by = args.target_actor_user_id
      document.updated_at = "2026-07-09T12:00:00.000Z"
    }

    return { data: true, error: null }
  }

  private getEffectiveDocumentAccess(
    organizationId: string,
    documentId: string,
    actorUserId: string
  ): DocumentAccessLevel | null {
    const membership = this.getActiveMembership(
      organizationId,
      actorUserId
    )
    const document = this.tables.documents.find(
      (row: FakeRow): boolean =>
        row.id === documentId && row.org_id === organizationId
    )

    if (!membership || !document) {
      return null
    }

    if (membership.role === "owner_admin") {
      return "contributor"
    }

    const creatorAccess =
      document.created_by === actorUserId ? "contributor" : null
    const directAccess = getHighestAccessLevel(
      creatorAccess,
      this.getGrantAccess(
        this.tables.document_access_grants,
        "document_id",
        documentId,
        organizationId,
        actorUserId,
        String(membership.role)
      )
    )
    const inheritedAccess = document.folder_id
      ? this.getInheritedFolderGrantAccess(
          organizationId,
          String(document.folder_id),
          actorUserId,
          String(membership.role)
        )
      : null

    const effectiveAccess = getHighestAccessLevel(
      directAccess,
      inheritedAccess
    )

    return membership.role === "external_reviewer" && effectiveAccess
      ? "viewer"
      : effectiveAccess
  }

  private getEffectiveFolderAccess(
    organizationId: string,
    folderId: string,
    actorUserId: string
  ): DocumentAccessLevel | null {
    const membership = this.getActiveMembership(
      organizationId,
      actorUserId
    )
    const folder = this.tables.folders.find(
      (row: FakeRow): boolean =>
        row.id === folderId && row.org_id === organizationId
    )

    if (!membership || !folder) {
      return null
    }

    if (membership.role === "owner_admin") {
      return "contributor"
    }

    const effectiveAccess = this.getInheritedFolderGrantAccess(
      organizationId,
      folderId,
      actorUserId,
      String(membership.role)
    )

    return membership.role === "external_reviewer" && effectiveAccess
      ? "viewer"
      : effectiveAccess
  }

  private getActiveMembership(
    organizationId: string,
    actorUserId: string
  ): FakeRow | null {
    return (
      this.tables.organization_memberships.find(
        (row: FakeRow): boolean =>
          row.org_id === organizationId &&
          row.user_id === actorUserId &&
          row.status === "active"
      ) ?? null
    )
  }

  private getInheritedFolderGrantAccess(
    organizationId: string,
    folderId: string,
    actorUserId: string,
    actorRole: string
  ): DocumentAccessLevel | null {
    const visitedFolderIds = new Set<string>()
    let currentFolderId: string | null = folderId
    let effectiveAccess: DocumentAccessLevel | null = null

    while (currentFolderId && !visitedFolderIds.has(currentFolderId)) {
      visitedFolderIds.add(currentFolderId)
      effectiveAccess = getHighestAccessLevel(
        effectiveAccess,
        this.getGrantAccess(
          this.tables.folder_access_grants,
          "folder_id",
          currentFolderId,
          organizationId,
          actorUserId,
          actorRole
        )
      )

      const folder = this.tables.folders.find(
        (row: FakeRow): boolean =>
          row.id === currentFolderId && row.org_id === organizationId
      )
      effectiveAccess = getHighestAccessLevel(
        effectiveAccess,
        folder?.created_by === actorUserId ? "contributor" : null
      )
      currentFolderId =
        typeof folder?.parent_folder_id === "string"
          ? folder.parent_folder_id
          : null
    }

    return effectiveAccess
  }

  private getGrantAccess(
    grants: FakeRow[],
    resourceColumn: "document_id" | "folder_id",
    resourceId: string,
    organizationId: string,
    actorUserId: string,
    actorRole: string
  ): DocumentAccessLevel | null {
    return grants.reduce<DocumentAccessLevel | null>(
      (
        effectiveAccess: DocumentAccessLevel | null,
        grant: FakeRow
      ): DocumentAccessLevel | null => {
        const appliesToActor =
          grant.user_id === actorUserId ||
          grant.organization_role === actorRole
        const accessLevel = parseAccessLevel(grant.access_level)

        if (
          grant.org_id !== organizationId ||
          grant[resourceColumn] !== resourceId ||
          !appliesToActor ||
          accessLevel === null
        ) {
          return effectiveAccess
        }

        return getHighestAccessLevel(effectiveAccess, accessLevel)
      },
      null
    )
  }
}

class FakeQueryBuilder {
  private readonly filters: Array<(row: FakeRow) => boolean> = []
  private insertRows: FakeRow[] | null = null
  private updateValues: FakeRow | null = null
  private orderColumn: string | null = null
  private orderAscending = true
  private limitCount: number | null = null

  constructor(
    private readonly client: FakeSupabaseClient,
    private readonly tableName: FakeTableName
  ) {}

  select(): FakeQueryBuilder {
    return this
  }

  insert(value: FakeRow | FakeRow[]): FakeQueryBuilder {
    this.insertRows = Array.isArray(value) ? value : [value]
    return this
  }

  update(value: FakeRow): FakeQueryBuilder {
    this.updateValues = value
    return this
  }

  eq(column: string, value: unknown): FakeQueryBuilder {
    this.filters.push((row: FakeRow) => row[column] === value)
    return this
  }

  is(column: string, value: unknown): FakeQueryBuilder {
    this.filters.push((row: FakeRow) => row[column] === value)
    return this
  }

  order(
    column: string,
    options: { ascending?: boolean } = {}
  ): FakeQueryBuilder {
    this.orderColumn = column
    this.orderAscending = options.ascending ?? true
    return this
  }

  limit(count: number): FakeQueryBuilder {
    this.limitCount = count
    return this
  }

  async single(): Promise<{ data: FakeRow | null; error: Error | null }> {
    const rows = this.execute()

    if (rows.length !== 1) {
      return { data: null, error: new Error("Expected one row.") }
    }

    return { data: rows[0], error: null }
  }

  async maybeSingle(): Promise<{ data: FakeRow | null; error: Error | null }> {
    const rows = this.execute()

    if (rows.length > 1) {
      return { data: null, error: new Error("Expected zero or one row.") }
    }

    return { data: rows[0] ?? null, error: null }
  }

  then<TResult1 = { data: FakeRow[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((
          value: { data: FakeRow[]; error: null }
        ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.execute(), error: null }).then(
      onfulfilled,
      onrejected
    )
  }

  private execute(): FakeRow[] {
    if (this.insertRows) {
      const insertedRows = this.insertRows.map((row: FakeRow) =>
        this.withTimestamps(row)
      )
      this.client.tables[this.tableName].push(...insertedRows)
      return insertedRows
    }

    const matchingRows = this.applyFilters()

    if (this.updateValues) {
      matchingRows.forEach((row: FakeRow) => {
        Object.assign(row, this.updateValues, {
          updated_at: "2026-07-09T12:00:00.000Z",
        })
      })
      return matchingRows
    }

    return matchingRows
  }

  private applyFilters(): FakeRow[] {
    let rows = this.client.tables[this.tableName].filter((row: FakeRow) =>
      this.filters.every((filter: (row: FakeRow) => boolean) => filter(row))
    )

    if (this.orderColumn) {
      rows = [...rows].sort((left: FakeRow, right: FakeRow) => {
        const leftValue = String(left[this.orderColumn ?? ""])
        const rightValue = String(right[this.orderColumn ?? ""])
        return this.orderAscending
          ? leftValue.localeCompare(rightValue)
          : rightValue.localeCompare(leftValue)
      })
    }

    if (this.limitCount !== null) {
      rows = rows.slice(0, this.limitCount)
    }

    return rows
  }

  private withTimestamps(row: FakeRow): FakeRow {
    const lifecycleDefaults =
      this.tableName === "folders" || this.tableName === "documents"
        ? {
            lifecycle_state: "active",
            trashed_by: null,
            trashed_at: null,
            purge_after: null,
            pre_trash_lifecycle_state: null,
            trash_operation_id: null,
          }
        : {}

    return {
      created_at: "2026-07-09T12:00:00.000Z",
      updated_at: "2026-07-09T12:00:00.000Z",
      ...lifecycleDefaults,
      ...row,
    }
  }
}

function parseAccessLevel(value: unknown): DocumentAccessLevel | null {
  return value === "viewer" || value === "contributor" ? value : null
}

function getHighestAccessLevel(
  left: DocumentAccessLevel | null,
  right: DocumentAccessLevel | null
): DocumentAccessLevel | null {
  if (left === "contributor" || right === "contributor") {
    return "contributor"
  }

  return left ?? right
}

/**
 * Builds an active organization membership fixture.
 *
 * @param role - Organization role for the member.
 * @returns Membership database row.
 */
export function createMembershipRow(role: OrganizationRole): FakeRow {
  return {
    id: `membership-${role}`,
    org_id: "org-1",
    user_id: "user-1",
    role,
    status: "active",
    created_at: "2026-07-09T11:00:00.000Z",
    updated_at: "2026-07-09T11:00:00.000Z",
  }
}

/**
 * Builds a document database row with optional overrides.
 *
 * @param overrides - Values that replace the default document fixture.
 * @returns Document database row.
 */
export function createDocumentRow(overrides: FakeRow = {}): FakeRow {
  const lifecycleState =
    typeof overrides.lifecycle_state === "string"
      ? overrides.lifecycle_state
      : overrides.archived_at
        ? "archived"
        : "active"

  return {
    id: "document-1",
    org_id: "org-1",
    folder_id: null,
    title: "Signed contract",
    description: null,
    current_version_id: "version-1",
    lifecycle_state: lifecycleState,
    created_by: "user-1",
    updated_by: "user-1",
    archived_by: null,
    archived_at: null,
    trashed_by: null,
    trashed_at: null,
    purge_after: null,
    pre_trash_lifecycle_state: null,
    trash_operation_id: null,
    created_at: "2026-07-09T11:00:00.000Z",
    updated_at: "2026-07-09T11:00:00.000Z",
    ...overrides,
  }
}

/**
 * Builds a document-version database row with optional overrides.
 *
 * @param overrides - Values that replace the default version fixture.
 * @returns Document-version database row.
 */
export function createVersionRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: "version-1",
    org_id: "org-1",
    document_id: "document-1",
    version_number: 1,
    status: "available",
    storage_key:
      "organizations/org-1/documents/document-1/versions/version-1/original.pdf",
    original_filename: "contract.pdf",
    content_type: "application/pdf",
    byte_size: 1024,
    checksum_sha256: null,
    uploaded_by: "user-1",
    created_at: "2026-07-09T11:00:00.000Z",
    updated_at: "2026-07-09T11:00:00.000Z",
    ...overrides,
  }
}

/**
 * Creates injectable document service dependencies backed by the fake client.
 *
 * @param client - In-memory Supabase client.
 * @param ids - Deterministic identifiers returned in order.
 * @returns Document service dependency overrides.
 */
export function createDeps(
  client: FakeSupabaseClient,
  ids: string[] = []
): DocumentServiceDeps {
  const idQueue = [...ids]

  return {
    client: client as never,
    createId: (): string => idQueue.shift() ?? "generated-id",
    recordAuditLog: vi.fn().mockResolvedValue(undefined),
    validateDocumentUploadRequest: vi.fn(),
    buildDocumentObjectKey: vi.fn(
      (input: {
        organizationId: string
        documentId: string
        versionId: string
      }): string =>
        `organizations/${input.organizationId}/documents/${input.documentId}/versions/${input.versionId}/original.pdf`
    ),
    createSignedDocumentUploadUrl: vi.fn(
      async (input: {
        organizationId: string
        documentId: string
        versionId: string
      }): Promise<{
        uploadUrl: string
        storageKey: string
        expiresInSeconds: number
      }> => ({
        uploadUrl: "https://r2.example/upload",
        storageKey: `organizations/${input.organizationId}/documents/${input.documentId}/versions/${input.versionId}/original.pdf`,
        expiresInSeconds: 900,
      })
    ),
    createSignedDocumentDownloadUrl: vi.fn().mockResolvedValue({
      downloadUrl: "https://r2.example/download",
      expiresInSeconds: 900,
    }),
    verifyDocumentUpload: vi.fn().mockResolvedValue(undefined),
  }
}
