import type {
  DocumentSigningRecipientStatus,
  GeneratedDocument,
  GeneratedDocumentWorkflowStatus,
} from "@/types/template"
import type { DocumentAccessLevel } from "@/types/document"

/** Member-facing signing recipient without the private token hash. */
export type DocumentSigningRecipient = {
  id: string
  organizationId: string
  documentId: string
  userId: string | null
  name: string
  email: string
  requiresSignature: boolean
  status: DocumentSigningRecipientStatus
  tokenExpiresAt: string
  invitedAt: string
  viewedAt: string | null
  signedAt: string | null
  consentedAt: string | null
  signedIp: string | null
  signatureDataUrl: string | null
  initialsDataUrl: string | null
}

type SigningViewBase = {
  organizationName: string
  document: GeneratedDocument
  accessLevel?: DocumentAccessLevel
  answers: Record<string, unknown>
  workflowStatus: GeneratedDocumentWorkflowStatus
}

/** Complete generated-document state available to an authorized organization member. */
export type MemberDocumentSigningView = SigningViewBase & {
  guest?: undefined
  recipients: DocumentSigningRecipient[]
  /** The signer who turned the last round down, until the document is sent again. */
  declined?: SigningDecline | null
}

/** Who declined to sign, why, and when. */
export type SigningDecline = { name: string; reason: string; declinedAt: string }

/** A generated document as a member or a guest may read it. */
export type GeneratedDocumentSigningView =
  | MemberDocumentSigningView
  | (SigningViewBase & {
      /** Read by someone outside the workspace, through a link to this document alone. */
      guest: true
      recipients: PublicSignerStatus[]
    })

/** Minimal co-signer state safe to display through an external private link. */
export type PublicSignerStatus = {
  id: string
  name: string
  requiresSignature: boolean
  status: DocumentSigningRecipientStatus
  signedAt: string | null
}

/** Generated-document state exposed only through one valid, expiring token. */
export type PublicDocumentSigningView = {
  organizationName: string
  document: GeneratedDocument
  answers: Record<string, unknown>
  workflowStatus: GeneratedDocumentWorkflowStatus
  requiresInitials: boolean
  recipient: {
    id: string
    name: string
    email: string
    requiresSignature: boolean
    status: DocumentSigningRecipientStatus
    tokenExpiresAt: string
    signedAt: string | null
    /** Their own drawings, once they have signed, for their own boxes. */
    signatureDataUrl: string | null
    initialsDataUrl: string | null
  }
  signers: PublicSignerStatus[]
}

/** One recipient to invite through a private signing link. */
export type DocumentRecipientInput = {
  name: string
  email: string
  userId?: string | null
  requiresSignature?: boolean
}

/** Result returned after recipient rows are created and invitations are accepted by email. */
export type SendDocumentForSigningResult = {
  documentId: string
  workflowStatus: "awaiting_signatures"
  recipients: DocumentSigningRecipient[]
}
