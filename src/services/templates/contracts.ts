import type { AdminSupabaseClient } from "@/lib/supabase/admin"
import type { TemplateContent } from "@/types/template"

export type TemplateServiceClient = Pick<AdminSupabaseClient, "from">

export type ListDocumentTemplatesInput = {
  actorUserId: string
  organizationId: string
}

export type GetDocumentTemplateInput = ListDocumentTemplatesInput & {
  templateId: string
}

export type CreateDocumentTemplateInput = ListDocumentTemplatesInput & {
  title: string
  description?: string | null
  content?: TemplateContent
}

export type UpdateDocumentTemplateInput = GetDocumentTemplateInput & {
  expectedRevision: number
  title?: string
  description?: string | null
  content?: TemplateContent
}

export type ChangeDocumentTemplateStatusInput = GetDocumentTemplateInput

export type CreateGeneratedDocumentInput = ListDocumentTemplatesInput & {
  folderId?: string | null
  templateId?: string | null
  title?: string
  description?: string | null
  content?: TemplateContent
}

export type RecordDocumentRecentAccessInput = ListDocumentTemplatesInput & {
  documentId: string
}

export type ListRecentDocumentsInput = ListDocumentTemplatesInput & {
  limit?: number
}

export type TemplateServiceDeps = {
  client?: TemplateServiceClient
  createId?: () => string
  now?: () => Date
}
