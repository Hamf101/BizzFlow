import type { AdminSupabaseClient } from "@/lib/supabase/admin"
import type { RecordAuditLogInput } from "@/services/audit-service"
import type {
  SendDocumentSigningCancelledEmailInput,
  SendDocumentSigningDeclinedEmailInput,
  SendDocumentSigningEmailInput,
} from "@/services/document-signing-email-service"
import type { DocumentRecipientInput } from "@/types/signing"

/** Supabase operations required by document-signing persistence helpers. */
export type SigningServiceClient = Pick<AdminSupabaseClient, "from" | "rpc">

/** Identifiers required to load a member-facing generated signing document. */
export type GetGeneratedDocumentSigningViewInput = {
  actorUserId: string
  organizationId: string
  documentId: string
}

/** Member answer patch submitted for a generated document. */
export type SaveGeneratedDocumentAnswersInput =
  GetGeneratedDocumentSigningViewInput & {
    values: Record<string, unknown>
  }

/** A draft's own title and page, saved from the editor. */
export type UpdateGeneratedDocumentContentInput =
  GetGeneratedDocumentSigningViewInput & {
    /** The document's `updatedAt` when the editor last loaded or saved it. */
    expectedUpdatedAt: string
    title: string
    /** Untrusted content, validated before it is stored. */
    content: unknown
  }

/** Signing recipients submitted by an authorized organization member. */
export type SendDocumentForSigningInput =
  GetGeneratedDocumentSigningViewInput & {
    recipients: DocumentRecipientInput[]
  }

/** Recipient whose private signing invitation should be refreshed. */
export type ResendDocumentSigningInvitationInput =
  GetGeneratedDocumentSigningViewInput & {
    recipientId: string
  }

/** Private token used to load a public signing view. */
export type GetPublicDocumentSigningViewInput = {
  token: string
}

/** Final answers and drawings submitted through a private signing link. */
export type CompletePublicDocumentSigningInput = {
  /** The signer agreed to sign electronically; nothing is signed without it. */
  consented: boolean
  /** The address the signature came from, kept for the completion certificate. */
  ip?: string | null
  token: string
  values: Record<string, unknown>
  baselineValues?: Record<string, unknown>
  signatureDataUrl: string | null
  initialsDataUrl?: string | null
}

/** Injectable signing dependencies used by production and focused tests. */
export type DocumentSigningServiceDeps = {
  client?: SigningServiceClient
  createId?: () => string
  createToken?: () => string
  now?: () => Date
  sendDocumentSigningEmail?: (
    input: SendDocumentSigningEmailInput
  ) => Promise<void>
  sendDocumentSigningCancelledEmail?: (
    input: SendDocumentSigningCancelledEmailInput
  ) => Promise<void>
  sendDocumentSigningDeclinedEmail?: (
    input: SendDocumentSigningDeclinedEmailInput
  ) => Promise<void>
  recordAuditLog?: (input: RecordAuditLogInput) => Promise<unknown>
}

/** A signer's private link and their reason for not signing. */
export type DeclinePublicDocumentSigningInput = {
  token: string
  reason: string
}
