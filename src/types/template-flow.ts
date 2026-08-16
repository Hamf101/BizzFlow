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

/** Deterministic usability finding attached to a Flow proposal for review. */
export type TemplateFlowQualityIssue = Readonly<{
  code: string
  severity: "critical" | "warning"
  message: string
  affectedBlockIds: readonly string[]
}>

/** Lifecycle states a session-local Flow proposal may enter before resolution. */
export type TemplateFlowProposalStatus = "pending" | "stale"

/**
 * One coherent candidate batch returned by Flow without changing the editor draft.
 *
 * Candidate drafts can contain embedded image bytes and therefore remain
 * session-local. Persisted history stores only the bounded operation receipt.
 */
export type TemplateFlowProposal = {
  id: string
  status: TemplateFlowProposalStatus
  baseDraftFingerprint: string
  candidateDraft: TemplateFlowDraft
  operations: TemplateFlowLedgerItem[]
  changedBlockIds: string[]
  qualityIssues: TemplateFlowQualityIssue[]
}

export type TemplateFlowMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  authorName: string | null
  operations: TemplateFlowLedgerItem[]
  changedBlockIds: string[]
  receiptStatus: "proposed" | null
  createdAt: string
}

export type TemplateFlowResult = {
  proposal: TemplateFlowProposal | null
  messages: [TemplateFlowMessage, TemplateFlowMessage]
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
