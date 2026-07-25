import type { TemplateContent } from "@/types/template"

export type TemplateFlowDraft = {
  title: string
  description: string
  content: TemplateContent
}

export type TemplateFlowOperationType =
  | "set_title"
  | "set_description"
  | "set_branding"
  | "add_block"
  | "update_block"
  | "update_image"
  | "move_block"
  | "remove_block"

export type TemplateFlowLedgerItem = {
  id: string
  type: TemplateFlowOperationType
  summary: string
  target: string
  affectedBlockIds: string[]
}

export type TemplateFlowMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  authorName: string | null
  operations: TemplateFlowLedgerItem[]
  changedBlockIds: string[]
  createdAt: string
}

export type TemplateFlowResult = {
  draft: TemplateFlowDraft
  messages: [TemplateFlowMessage, TemplateFlowMessage]
  changedBlockIds: string[]
  needsConfirmation: boolean
  persistenceWarning: string | null
}

/** Database row for one template-scoped Flow conversation entry. */
export type TemplateFlowMessageRow = Record<string, unknown> & {
  id: string
  org_id: string
  template_id: string
  author_user_id: string | null
  author_name: string | null
  role: "user" | "assistant"
  content: string
  change_set: Record<string, unknown> | null
  created_at: string
}
