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
  | "set_section"
  | "set_row"
  | "stand_alone"
  | "set_block_rule"
  | "set_layout"

export type TemplateFlowLedgerItem = {
  id: string
  type: TemplateFlowOperationType
  summary: string
  target: string
  affectedBlockIds: string[]
  /** Indices of the earlier changes in the same batch this one cannot stand without. */
  dependsOn: number[]
}

/**
 * One change as Flow's response gave it, kept so a batch can be rebuilt on the
 * server from the changes a reviewer keeps. The browser never reads inside it.
 */
export type TemplateFlowWireOperation = {
  type: TemplateFlowOperationType
  summary: string
  payload: Record<string, unknown>
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
  /** The changes behind `operations`, one each, in the same order. */
  wireOperations: TemplateFlowWireOperation[]
  changedBlockIds: string[]
  qualityIssues: TemplateFlowQualityIssue[]
  /**
   * The answers written on the form it was recreated from, keyed by the
   * candidate's field keys, to fill a copy with. Never signatures or files.
   */
  sourceAnswers?: Record<string, unknown>
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

/** What filling with a form's answers did: a filled copy to open, or the answers the page now holds; or why not. */
export type FlowFillResult =
  | Readonly<{ answers?: Record<string, unknown>; dropped: number; href?: string; kept: number; ok: true }>
  | Readonly<{ message: string; ok: false }>

/** The kinds of file Flow recreates a form from; the server checks each again by its bytes. */
export const FLOW_FILE_TYPES: readonly string[] = ["application/pdf", "image/png", "image/jpeg"]
