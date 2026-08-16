import type { AdminSupabaseClient } from "@/lib/supabase/admin"
import type { SendDocumentSigningEmailInput } from "@/services/document-signing-email-service"
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
}
