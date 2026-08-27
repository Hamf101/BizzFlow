import type { AdminSupabaseClient } from "@/lib/supabase/admin"
import type { TemplateContent } from "@/types/template"

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
