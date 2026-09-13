import type { ListSort } from "@/lib/list-state"
import type { AdminSupabaseClient } from "@/lib/supabase/admin"
import type {
  DocumentTemplateStatus,
  DocumentTemplateSummary,
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
  sort: ListSort<TemplateSortKey>
  statuses?: readonly DocumentTemplateStatus[]
}

/** One page of templates and how many match its filters. */
export type TemplatePage = {
  page: number
  pageSize: number
  templates: DocumentTemplateSummary[]
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

export type ListRecentDocumentsInput = TemplateActorInput & {
  limit?: number
}

export type TemplateServiceDeps = {
  client?: TemplateServiceClient
  createId?: () => string
  now?: () => Date
}
