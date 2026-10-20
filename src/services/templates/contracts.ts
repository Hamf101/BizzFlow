import type { ListSort } from "@/lib/list-state"
import type { AdminSupabaseClient } from "@/lib/supabase/admin"
import type { RecordAuditLogInput } from "@/services/audit-service"
import type {
  DocumentTemplateCard,
  DocumentTemplateStatus,
  TemplateContent,
  TemplateSortKey,
} from "@/types/template"

export type TemplateServiceClient = Pick<AdminSupabaseClient, "from" | "rpc">

/** Actor and tenant identifiers carried by every template operation. */
export type TemplateActorInput = {
  actorUserId: string
  organizationId: string
}

export type ListDocumentTemplatesInput = TemplateActorInput & {
  /**
   * Category filter. Omit for every category; pass `null` to select the
   * uncategorised templates specifically.
   */
  category?: string | null
}

/** Input for one page of the templates an actor may see. */
export type ListTemplatePageInput = TemplateActorInput & {
  /** A category, null for uncategorised templates, or undefined for all. */
  category?: string | null
  /** One-based page number. */
  page: number
  pageSize: number
  /** Title search text; matched literally, ignoring case. */
  query?: string
  /** Lists only the templates in Trash; every other list leaves them out. */
  trash?: boolean
  sort: ListSort<TemplateSortKey>
  statuses?: readonly DocumentTemplateStatus[]
}

/** One page of template cards and how many match its filters. */
export type TemplatePage = {
  page: number
  pageSize: number
  templates: DocumentTemplateCard[]
  total: number
}

export type GetDocumentTemplateInput = TemplateActorInput & {
  templateId: string
}

export type CreateDocumentTemplateInput = TemplateActorInput & {
  title: string
  description?: string | null
  category?: string | null
  content?: TemplateContent
}

export type UpdateDocumentTemplateInput = GetDocumentTemplateInput & {
  expectedRevision: number
  title?: string
  description?: string | null
  category?: string | null
  content?: TemplateContent
}

export type PublishDocumentTemplateInput = GetDocumentTemplateInput & {
  expectedRevision: number
}

export type ChangeDocumentTemplateStatusInput = GetDocumentTemplateInput

export type DuplicateDocumentTemplateInput = GetDocumentTemplateInput

/** A template in Trash, and its exact title typed to delete it for good. */
export type PurgeTrashedDocumentTemplateInput = GetDocumentTemplateInput & {
  confirmationTitle: string
}

export type SetDocumentTemplateCategoryInput = GetDocumentTemplateInput & {
  category: string | null
}

/** Most templates one bulk change may cover; a larger selection is chunked by the caller. */
export const MAX_BULK_TEMPLATES = 200

export type ChangeDocumentTemplatesInput = TemplateActorInput & {
  change: "archive" | "restore" | "trash" | "duplicate" | "category"
  /** The category to set; only read by the `category` change. */
  category?: string | null
  templateIds: readonly string[]
}

/** What a bulk change did, with what Undo needs to put it back. */
export type ChangeDocumentTemplatesResult = {
  /** The templates that changed (for a duplicate, the ones copied). */
  changed: string[]
  /** The new drafts a duplicate made, in the order of `changed`. */
  created: string[]
  failed: number
  /** How many were refused because people have sent answers through them, which only archiving allows. */
  answered: number
  /** For a category change: what each changed template's category was. */
  previousCategories: Record<string, string | null>
}

export type CreateGeneratedDocumentInput = TemplateActorInput & {
  folderId?: string | null
  templateId?: string | null
  title?: string
  description?: string | null
  content?: TemplateContent
}

export type RecordDocumentRecentAccessInput = TemplateActorInput & {
  documentId: string
}

export type TemplateServiceDeps = {
  client?: TemplateServiceClient
  createId?: () => string
  now?: () => Date
  recordAuditLog?: (input: RecordAuditLogInput) => Promise<unknown>
}
