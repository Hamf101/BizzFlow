export const PUBLIC_FORM_LINK_STATUSES = ["active", "expired", "disabled"] as const

export type PublicFormLinkStatus = (typeof PUBLIC_FORM_LINK_STATUSES)[number]

export type PublicFormLink = {
  id: string
  organizationId: string
  templateId: string
  /**
   * Empty unless the app can derive it: every link keeps only its token's
   * hash, so a link sent to one person, and a link for anyone made before
   * tokens were derived, cannot be shown again.
   */
  token: string
  /** Who a link was sent to; null on a link for anyone. */
  recipientEmail: string | null
  /** The document a link was sent from, while it exists. */
  documentId: string | null
  status: PublicFormLinkStatus
  expiresAt: string | null
  maxSubmissions: number | null
  submissionCount: number
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Parses a raw database public_form_links row into a validated PublicFormLink domain object.
 *
 * @param row - Database public_form_links row.
 * @returns Strongly typed PublicFormLink.
 */
export function parsePublicFormLinkRow(row: unknown): PublicFormLink {
  if (!row || typeof row !== "object") {
    throw new Error("Invalid public form link row: expected an object.")
  }

  const record = row as Record<string, unknown>

  const id = typeof record.id === "string" ? record.id : ""
  const organizationId = typeof record.org_id === "string" ? record.org_id : ""
  const templateId = typeof record.template_id === "string" ? record.template_id : ""
  const token = typeof record.token === "string" ? record.token : ""
  const recipientEmail = typeof record.recipient_email === "string" ? record.recipient_email : null
  const documentId = typeof record.document_id === "string" ? record.document_id : null
  // A status this build does not know must not open the form to anyone.
  const status = PUBLIC_FORM_LINK_STATUSES.includes(record.status as PublicFormLinkStatus)
    ? (record.status as PublicFormLinkStatus)
    : "disabled"
  const expiresAt = typeof record.expires_at === "string" ? record.expires_at : null
  const maxSubmissions = typeof record.max_submissions === "number" ? record.max_submissions : null
  const submissionCount = typeof record.submission_count === "number" ? record.submission_count : 0
  const createdBy = typeof record.created_by === "string" ? record.created_by : null
  const createdAt = typeof record.created_at === "string" ? record.created_at : ""
  const updatedAt = typeof record.updated_at === "string" ? record.updated_at : ""

  return {
    id,
    organizationId,
    templateId,
    token,
    recipientEmail,
    documentId,
    status,
    expiresAt,
    maxSubmissions,
    submissionCount,
    createdBy,
    createdAt,
    updatedAt,
  }
}
