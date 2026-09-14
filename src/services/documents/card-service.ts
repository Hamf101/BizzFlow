import { getEffectiveDocumentAccessLevels } from "@/services/documents/access-service"
import type {
  DocumentServiceClient,
  DocumentServiceDeps,
  ListDocumentCardsInput,
} from "@/services/documents/contracts"
import {
  createSupabaseServiceError,
  getClient,
  requirePermission,
  runDocumentOperation,
} from "@/services/documents/shared"
import {
  templateContentSchema,
  type GeneratedDocumentWorkflowStatus,
  type TemplateContent,
} from "@/types/template"

/** Most documents whose first page one Files view draws. */
const MAX_DOCUMENT_CARD_CONTENTS = 60

/** Ids per status read, so each request's filter stays a short URL. */
const STATUS_READ_BATCH = 100

const WORKFLOW_STATUSES: readonly GeneratedDocumentWorkflowStatus[] = [
  "draft",
  "awaiting_signatures",
  "completed",
]

/** What a Files view draws for one document beyond its name and dates. */
export type DocumentCard = {
  /** The document's first page, or null for an upload or an unreadable page. */
  content: TemplateContent | null
  id: string
  /** Where a generated document stands; null for an upload. */
  workflowStatus: GeneratedDocumentWorkflowStatus | null
}

/**
 * Reads the status of the documents a Files view shows, and the first page of
 * the ones it draws, keeping only documents the member can reach.
 *
 * @param input - Actor, organization, and the view's document ids.
 * @param deps - Optional service dependencies for tests.
 * @returns One card per reachable document, in the order asked for.
 * @throws DocumentServiceError when the actor lacks access or reads fail.
 */
export async function listDocumentCards(
  input: ListDocumentCardsInput,
  deps: DocumentServiceDeps = {}
): Promise<DocumentCard[]> {
  return runDocumentOperation(
    "list_document_cards",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      documents: input.documentIds.length,
    },
    async (): Promise<DocumentCard[]> => {
      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "documents:view",
        "You cannot view documents."
      )

      const access = await getEffectiveDocumentAccessLevels(
        {
          actorUserId: input.actorUserId,
          ids: [...new Set([...input.documentIds, ...input.contentIds])],
          organizationId: input.organizationId,
        },
        client
      )
      const reachable = input.documentIds.filter((id: string): boolean =>
        access.has(id)
      )
      const statuses = await readWorkflowStatuses(
        client,
        input.organizationId,
        reachable
      )
      const contents = await readCardContents(
        client,
        input.organizationId,
        input.contentIds
          .filter((id: string): boolean => access.has(id))
          .slice(0, MAX_DOCUMENT_CARD_CONTENTS)
      )

      return reachable.map(
        (id: string): DocumentCard => ({
          content: contents.get(id) ?? null,
          id,
          workflowStatus: statuses.get(id) ?? null,
        })
      )
    }
  )
}

async function readWorkflowStatuses(
  client: DocumentServiceClient,
  organizationId: string,
  documentIds: readonly string[]
): Promise<Map<string, GeneratedDocumentWorkflowStatus>> {
  const statuses = new Map<string, GeneratedDocumentWorkflowStatus>()

  for (let start = 0; start < documentIds.length; start += STATUS_READ_BATCH) {
    const { data, error } = await client
      .from("document_answers")
      .select("document_id,workflow_status")
      .eq("org_id", organizationId)
      .in("document_id", documentIds.slice(start, start + STATUS_READ_BATCH))

    if (error || !data) {
      throw createSupabaseServiceError(error, "Unable to load document statuses.")
    }

    for (const row of data as Array<{ document_id: string; workflow_status: string }>) {
      const status = WORKFLOW_STATUSES.find(
        (candidate: GeneratedDocumentWorkflowStatus): boolean =>
          candidate === row.workflow_status
      )

      if (status) {
        statuses.set(row.document_id, status)
      }
    }
  }

  return statuses
}

async function readCardContents(
  client: DocumentServiceClient,
  organizationId: string,
  documentIds: readonly string[]
): Promise<Map<string, TemplateContent>> {
  const contents = new Map<string, TemplateContent>()

  if (documentIds.length === 0) {
    return contents
  }

  const { data, error } = await client.rpc("document_card_contents", {
    document_ids: [...documentIds],
    target_org_id: organizationId,
  })

  // A view without pages still lists every file, so a failed read only warns.
  if (error) {
    console.warn("document_card_contents_unavailable", {
      organizationId,
      reason: error.message,
    })
    return contents
  }

  for (const row of data ?? []) {
    const parsed = templateContentSchema.safeParse(row.content)

    if (parsed.success) {
      contents.set(row.id, parsed.data)
    }
  }

  return contents
}
