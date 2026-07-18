import type { ReactElement } from "react"

import { Badge } from "@/components/ui/badge"
import type {
  DocumentSigningRecipientStatus,
  DocumentTemplateStatus,
  GeneratedDocumentWorkflowStatus,
} from "@/types/template"

/**
 * Displays a generated document's workflow state with consistent badge styling.
 *
 * @param props - Current generated-document workflow status.
 * @returns Status badge for draft, awaiting-signatures, or completed state.
 */
export function SigningWorkflowBadge({
  status,
}: {
  status: GeneratedDocumentWorkflowStatus
}): ReactElement {
  if (status === "completed") {
    return <Badge>Completed</Badge>
  }

  if (status === "awaiting_signatures") {
    return <Badge variant="secondary">Awaiting signatures</Badge>
  }

  return <Badge variant="outline">Draft</Badge>
}

/**
 * Displays a document recipient's signing state with consistent badge styling.
 *
 * @param props - Current signing-recipient status.
 * @returns Status badge for pending, viewed, or signed state.
 */
export function SigningRecipientStatusBadge({
  status,
}: {
  status: DocumentSigningRecipientStatus
}): ReactElement {
  if (status === "signed") {
    return <Badge>Signed</Badge>
  }

  if (status === "viewed") {
    return <Badge variant="secondary">Viewed</Badge>
  }

  return <Badge variant="outline">Pending</Badge>
}

/**
 * Displays a template's lifecycle state with consistent badge styling.
 *
 * @param props - Current template lifecycle status.
 * @returns Status badge for draft, published, or archived state.
 */
export function TemplateStatusBadge({
  status,
}: {
  status: DocumentTemplateStatus
}): ReactElement {
  if (status === "published") {
    return <Badge>Published</Badge>
  }

  if (status === "archived") {
    return <Badge variant="destructive">Archived</Badge>
  }

  return <Badge variant="secondary">Draft</Badge>
}
