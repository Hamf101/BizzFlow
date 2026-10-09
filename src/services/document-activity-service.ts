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
import {
  requireDocumentAccess,
  requireDocumentAccessAs,
  requireReadableDocument,
} from "@/services/documents/access-service"
import {
  DOCUMENT_ACTIVITY_EVENT_TYPES,
  type ActivityMetadata,
  type ActivityMetadataValue,
  type DocumentActivityEvent,
  type DocumentActivityEventRow,
  type DocumentActivityEventType,
} from "@/types/activity"
import { runOperation, type LogValue } from "@/services/operation"
import { ServiceError } from "@/services/service-error"
import { normalizeLimit } from "@/services/input"

type DocumentActivityServiceClient = Pick<AdminSupabaseClient, "from" | "rpc">

export type ListDocumentActivityInput = {
  actorUserId: string
  organizationId: string
  documentId: string
  limit?: number
}

export type DocumentActivityServiceDeps = {
  client?: DocumentActivityServiceClient
}

/**
 * Error raised by document activity operations.
 */
export class DocumentActivityServiceError extends ServiceError {
  override readonly name = "DocumentActivityServiceError"
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
        .limit(normalizeLimit(input.limit, "Document activity", 50, 100, (message) => new DocumentActivityServiceError(message, 400)))

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

      // An event newer than this build is left out rather than failing the feed.
      return rows.flatMap((row: DocumentActivityEventRow) => {
        if (!isDocumentActivityEventType(row.event_type)) {
          console.warn("document_activity_unknown_event", { eventType: row.event_type })
          return []
        }

        return [mapDocumentActivityEvent(row, profileById, row.event_type)]
      })
    }
  )
}

async function requireDocumentViewPermission(
  client: DocumentActivityServiceClient,
  organizationId: string,
  documentId: string,
  actorUserId: string
): Promise<void> {
  await requireDocumentAccessAs(
    requireDocumentAccess(
      {
        organizationId,
        documentId,
        actorUserId,
        requiredAccess: "viewer",
        operation: "read",
        requiredOrganizationPermissionAction: "documents:view",
      },
      client
    ),
    (message, statusCode) => new DocumentActivityServiceError(message, statusCode),
    "You cannot view document activity."
  )
}

// Only active and archived documents are readable; trash, purge and any state
// newer than this build read as not found.
async function requireReadableTenantDocument(
  client: DocumentActivityServiceClient,
  organizationId: string,
  documentId: string
): Promise<void> {
  requireReadableDocument(
    await client
      .from("documents")
      .select("id,lifecycle_state")
      .eq("id", documentId)
      .eq("org_id", organizationId)
      .maybeSingle(),
    {
      loadFailed: () => new DocumentActivityServiceError("Unable to load document.", 500),
      notFound: () => new DocumentActivityServiceError("Document was not found.", 404),
    }
  )
}

function mapDocumentActivityEvent(
  row: DocumentActivityEventRow,
  profileById: ReadonlyMap<string, DocumentCollaborationProfileRow>,
  eventType: DocumentActivityEventType
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
    eventType,
    metadata: parseActivityMetadata(row.metadata),
    createdAt: row.created_at,
  }
}

function isDocumentActivityEventType(value: string): value is DocumentActivityEventType {
  return DOCUMENT_ACTIVITY_EVENT_TYPES.includes(value as DocumentActivityEventType)
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


function runDocumentActivityOperation<T>(
  operationName: string,
  identifiers: Record<string, LogValue>,
  operation: () => Promise<T>
): Promise<T> {
  return runOperation("document_activity", toDocumentActivityServiceError, operationName, identifiers, operation)
}

function toDocumentActivityServiceError(error: unknown): DocumentActivityServiceError {
  return error instanceof DocumentActivityServiceError
    ? error
    : new DocumentActivityServiceError("Document activity service failed.", 500)
}

function getClient(
  deps: DocumentActivityServiceDeps
): DocumentActivityServiceClient {
  return deps.client ?? createAdminClient()
}

