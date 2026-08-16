export const PUBLIC_FORM_LINK_STATUSES = ["active", "expired", "disabled"] as const

export type PublicFormLinkStatus = (typeof PUBLIC_FORM_LINK_STATUSES)[number]

export type PublicFormLink = {
  id: string
  organizationId: string
  templateId: string
  token: string
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
  const status = PUBLIC_FORM_LINK_STATUSES.includes(record.status as PublicFormLinkStatus)
    ? (record.status as PublicFormLinkStatus)
    : "active"
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
    status,
    expiresAt,
    maxSubmissions,
    submissionCount,
    createdBy,
    createdAt,
    updatedAt,
  }
}
