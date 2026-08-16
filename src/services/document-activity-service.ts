import { randomUUID } from "node:crypto"

import {
  createAdminClient,
  type AdminSupabaseClient,
} from "@/lib/supabase/admin"
import {
  indexDocumentCollaborationProfiles,
  listDocumentCollaborationProfiles,
  resolveDocumentCollaborationDisplayName,
  uniqueDocumentCollaborationProfileIds,
  type DocumentCollaborationProfileRow,
} from "@/services/document-collaboration/profiles"
import { requireDocumentAccess } from "@/services/documents/access-service"
import { DocumentServiceError } from "@/services/documents/errors"
import {
  DOCUMENT_ACTIVITY_EVENT_TYPES,
  type ActivityMetadata,
  type ActivityMetadataValue,
  type DocumentActivityEvent,
  type DocumentActivityEventRow,
  type DocumentActivityEventType,
} from "@/types/activity"

type DocumentActivityServiceClient = Pick<AdminSupabaseClient, "from" | "rpc">

type LogValue = string | number | boolean | null | undefined

type DocumentStateRow = {
  lifecycle_state?: unknown
}

export type RecordDocumentActivityInput = {
  organizationId: string
  documentId: string
  actorUserId: string | null
  eventType: DocumentActivityEventType
  metadata?: ActivityMetadata
}

export type ListDocumentActivityInput = {
  actorUserId: string
  organizationId: string
  documentId: string
  limit?: number
}

export type DocumentActivityServiceDeps = {
  client?: DocumentActivityServiceClient
  createId?: () => string
}

/**
 * Error raised by document activity operations.
 */
export class DocumentActivityServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates a document activity service error.
   *
   * @param message - User-safe error message.
   * @param statusCode - HTTP-style status code for route/action translation.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "DocumentActivityServiceError"
    this.statusCode = statusCode
  }
}

/**
 * Records an immutable document activity event from a trusted server workflow.
 *
 * @param input - Tenant, document, actor, event, and metadata values.
 * @param deps - Optional data-access dependencies for tests and composition.
 * @returns A promise that resolves after the event is stored.
 * @throws DocumentActivityServiceError when the document is outside the tenant or the write fails.
 */
export async function recordDocumentActivity(
  input: RecordDocumentActivityInput,
  deps: DocumentActivityServiceDeps = {}
): Promise<void> {
  return runDocumentActivityOperation(
    "record_document_activity",
    {
      organizationId: input.organizationId,
      documentId: input.documentId,
      actorUserId: input.actorUserId,
      eventType: input.eventType,
    },
    async (): Promise<void> => {
      const client = getClient(deps)

      await requireTenantDocument(
        client,
        input.organizationId,
        input.documentId
      )

      const { error } = await client.from("document_activity_events").insert({
        id: createId(deps),
        org_id: input.organizationId,
        document_id: input.documentId,
        actor_user_id: input.actorUserId,
        event_type: parseDocumentActivityEventType(input.eventType),
        metadata: input.metadata ?? {},
      })

      if (error) {
        throw new DocumentActivityServiceError(
          "Unable to record document activity.",
          500
        )
      }
    }
  )
}

/**
 * Lists recent activity for a tenant-scoped document in newest-first order.
 *
 * @param input - Actor, tenant, document, and optional result limit.
 * @param deps - Optional data-access dependencies for tests and composition.
 * @returns Activity DTOs with actor display labels resolved in one profile query.
 * @throws DocumentActivityServiceError when access is denied or data cannot be loaded.
 */
export async function listDocumentActivity(
  input: ListDocumentActivityInput,
  deps: DocumentActivityServiceDeps = {}
): Promise<DocumentActivityEvent[]> {
  return runDocumentActivityOperation(
    "list_document_activity",
    {
      organizationId: input.organizationId,
      documentId: input.documentId,
      actorUserId: input.actorUserId,
    },
    async (): Promise<DocumentActivityEvent[]> => {
      const client = getClient(deps)

      await requireDocumentViewPermission(
        client,
        input.organizationId,
        input.documentId,
        input.actorUserId
      )
      await requireReadableTenantDocument(
        client,
        input.organizationId,
        input.documentId
      )

      const { data, error } = await client
        .from("document_activity_events")
        .select(
          "id,org_id,document_id,actor_user_id,event_type,metadata,created_at"
        )
        .eq("org_id", input.organizationId)
        .eq("document_id", input.documentId)
        .order("created_at", { ascending: false })
        .limit(normalizeLimit(input.limit))

      if (error || !data) {
        throw new DocumentActivityServiceError(
          "Unable to load document activity.",
          500
        )
      }

      const rows = data as DocumentActivityEventRow[]
      const profiles = await listDocumentCollaborationProfiles(
        client,
        uniqueDocumentCollaborationProfileIds(
          rows.map((row: DocumentActivityEventRow) => row.actor_user_id)
        ),
        (): Error =>
          new DocumentActivityServiceError(
            "Unable to load activity actors.",
            500
          )
      )
      const profileById = indexDocumentCollaborationProfiles(profiles)

      return rows.map((row: DocumentActivityEventRow) =>
        mapDocumentActivityEvent(row, profileById)
      )
    }
  )
}

async function requireDocumentViewPermission(
  client: DocumentActivityServiceClient,
  organizationId: string,
  documentId: string,
  actorUserId: string
): Promise<void> {
  try {
    await requireDocumentAccess(
      {
        organizationId,
        documentId,
        actorUserId,
        requiredAccess: "viewer",
        operation: "read",
        requiredOrganizationPermissionAction: "documents:view",
      },
      client
    )
  } catch (error: unknown) {
    if (error instanceof DocumentServiceError) {
      throw new DocumentActivityServiceError(
        error.statusCode === 403
          ? "You cannot view document activity."
          : error.message,
        error.statusCode
      )
    }

    throw error
  }
}

async function requireTenantDocument(
  client: DocumentActivityServiceClient,
  organizationId: string,
  documentId: string
): Promise<void> {
  const { data, error } = await client
    .from("documents")
    .select("id")
    .eq("id", documentId)
    .eq("org_id", organizationId)
    .maybeSingle()

  if (error) {
    throw new DocumentActivityServiceError("Unable to load document.", 500)
  }

  if (!data) {
    throw new DocumentActivityServiceError("Document was not found.", 404)
  }
}

async function requireReadableTenantDocument(
  client: DocumentActivityServiceClient,
  organizationId: string,
  documentId: string
): Promise<void> {
  const { data, error } = await client
    .from("documents")
    .select("id,lifecycle_state")
    .eq("id", documentId)
    .eq("org_id", organizationId)
    .maybeSingle()

  if (error) {
    throw new DocumentActivityServiceError("Unable to load document.", 500)
  }

  if (!data) {
    throw new DocumentActivityServiceError("Document was not found.", 404)
  }

  const lifecycleState = (data as DocumentStateRow).lifecycle_state

  if (
    lifecycleState === "trashed" ||
    lifecycleState === "purge_pending"
  ) {
    throw new DocumentActivityServiceError("Document was not found.", 404)
  }

  if (
    lifecycleState !== undefined &&
    lifecycleState !== null &&
    lifecycleState !== "active" &&
    lifecycleState !== "archived"
  ) {
    throw new DocumentActivityServiceError(
      "Database returned an unsupported document lifecycle state.",
      500
    )
  }
}

function mapDocumentActivityEvent(
  row: DocumentActivityEventRow,
  profileById: ReadonlyMap<string, DocumentCollaborationProfileRow>
): DocumentActivityEvent {
  return {
    id: row.id,
    organizationId: row.org_id,
    documentId: row.document_id,
    actorUserId: row.actor_user_id,
    actorDisplayName: resolveDocumentCollaborationDisplayName(
      row.actor_user_id,
      profileById,
      "System"
    ),
    eventType: parseDocumentActivityEventType(row.event_type),
    metadata: parseActivityMetadata(row.metadata),
    createdAt: row.created_at,
  }
}

function parseDocumentActivityEventType(
  value: string
): DocumentActivityEventType {
  if (
    DOCUMENT_ACTIVITY_EVENT_TYPES.includes(
      value as DocumentActivityEventType
    )
  ) {
    return value as DocumentActivityEventType
  }

  throw new DocumentActivityServiceError(
    "Database returned an unsupported document activity event.",
    500
  )
}

function parseActivityMetadata(value: Record<string, unknown>): ActivityMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DocumentActivityServiceError(
      "Database returned invalid document activity metadata.",
      500
    )
  }

  const metadata: ActivityMetadata = {}

  Object.entries(value).forEach(([key, entryValue]: [string, unknown]) => {
    if (isActivityMetadataValue(entryValue)) {
      metadata[key] = entryValue
    }
  })

  return metadata
}

function isActivityMetadataValue(
  value: unknown
): value is ActivityMetadataValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  )
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return 50
  }

  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new DocumentActivityServiceError(
      "Document activity limit must be between 1 and 100.",
      400
    )
  }

  return value
}

async function runDocumentActivityOperation<T>(
  operationName: string,
  identifiers: Record<string, LogValue>,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now()

  try {
    const result = await operation()
    console.info("document_activity_service_success", {
      operationName,
      durationMs: Date.now() - startedAt,
      ...identifiers,
    })
    return result
  } catch (error: unknown) {
    if (error instanceof DocumentActivityServiceError) {
      console.warn("document_activity_service_rejected", {
        operationName,
        statusCode: error.statusCode,
        reason: error.message,
        durationMs: Date.now() - startedAt,
        ...identifiers,
      })
      throw error
    }

    console.error("document_activity_service_failed", {
      operationName,
      reason: error instanceof Error ? error.message : "Unknown activity error",
      durationMs: Date.now() - startedAt,
      ...identifiers,
    })
    throw new DocumentActivityServiceError(
      "Document activity service failed.",
      500
    )
  }
}

function getClient(
  deps: DocumentActivityServiceDeps
): DocumentActivityServiceClient {
  return deps.client ?? createAdminClient()
}

function createId(deps: DocumentActivityServiceDeps): string {
  return deps.createId ? deps.createId() : randomUUID()
}
