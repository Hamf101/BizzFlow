import { createAdminClient } from "@/lib/supabase/admin"
import { templateRequiresRecipientInitials } from "@/services/document-signing/answer-validation"
import type { SigningServiceClient } from "@/services/document-signing/contracts"
import {
  getDrawingDataUrl,
  type DrawingData,
} from "@/services/document-signing/drawing-validation"
import {
  createDatabaseError,
  DocumentSigningServiceError,
} from "@/services/document-signing/errors"
import {
  GENERATED_DOCUMENT_COLUMNS,
  mapGeneratedDocumentRow,
  type GeneratedDocumentRow,
} from "@/services/generated-documents/generated-document-persistence"
import type {
  DocumentSigningRecipient,
  GeneratedDocumentSigningView,
  PublicDocumentSigningView,
  PublicSignerStatus,
} from "@/types/signing"
import {
  parseTemplateContent,
  type DocumentAnswerRow,
  type DocumentSigningRecipientRow,
  type GeneratedDocument,
  type GeneratedDocumentWorkflowStatus,
  type TemplateContent,
} from "@/types/template"

const ANSWER_COLUMNS =
  "document_id,org_id,values,workflow_status,created_at,updated_at"
const RECIPIENT_COLUMNS =
  "id,org_id,document_id,user_id,name,email,requires_signature,status,token_hash,token_expires_at,invited_at,viewed_at,signed_at,signature_data,initials_data"

type OrganizationRow = {
  name: string
}

/** Values required to persist a refreshed private recipient link. */
export type RefreshSigningRecipientLinkInput = {
  recipientId: string
  documentId: string
  organizationId: string
  tokenHash: string
  tokenExpiresAt: string
  invitedAt: string
}

/** Values passed to the atomic public signing completion RPC. */
export type CompleteRecipientSignatureInput = {
  organizationId: string
  documentId: string
  recipientId: string
  tokenHash: string
  values: Record<string, unknown>
  signatureData: DrawingData | null
  initialsData: DrawingData | null
}

/**
 * Resolves the injected signing client or the server-only admin client.
 *
 * @param client - Optional focused test client.
 * @returns Client exposing the exact database operations required by signing.
 */
export function resolveSigningClient(
  client?: SigningServiceClient
): SigningServiceClient {
  return client ?? createAdminClient()
}

/**
 * Loads one tenant-scoped generated document with answers and recipients.
 *
 * @param client - Signing persistence client.
 * @param organizationId - Tenant identifier.
 * @param documentId - Generated-document identifier.
 * @returns Complete member-facing signing view.
 * @throws DocumentSigningServiceError when required persistence data is absent.
 */
export async function loadGeneratedDocumentView(
  client: SigningServiceClient,
  organizationId: string,
  documentId: string
): Promise<GeneratedDocumentSigningView> {
  const [documentResult, answerResult, recipientResult, organizationResult] =
    await Promise.all([
      client
        .from("documents")
        .select(GENERATED_DOCUMENT_COLUMNS)
        .eq("id", documentId)
        .eq("org_id", organizationId)
        .maybeSingle(),
      client
        .from("document_answers")
        .select(ANSWER_COLUMNS)
        .eq("document_id", documentId)
        .eq("org_id", organizationId)
        .maybeSingle(),
      client
        .from("document_signing_recipients")
        .select(RECIPIENT_COLUMNS)
        .eq("document_id", documentId)
        .eq("org_id", organizationId)
        .order("invited_at", { ascending: true }),
      client
        .from("organizations")
        .select("name")
        .eq("id", organizationId)
        .maybeSingle(),
    ])

  if (documentResult.error) {
    throw createDatabaseError(
      documentResult.error,
      "Unable to load generated document."
    )
  }

  if (!documentResult.data) {
    throw new DocumentSigningServiceError(
      "Generated document was not found.",
      404
    )
  }

  if (answerResult.error || !answerResult.data) {
    throw createDatabaseError(
      answerResult.error,
      "Unable to load document answers."
    )
  }

  if (recipientResult.error || !recipientResult.data) {
    throw createDatabaseError(
      recipientResult.error,
      "Unable to load signing recipients."
    )
  }

  if (organizationResult.error || !organizationResult.data) {
    throw createDatabaseError(
      organizationResult.error,
      "Unable to load document organization."
    )
  }

  const document = mapGeneratedDocument(
    documentResult.data as GeneratedDocumentRow
  )
  const answer = answerResult.data as DocumentAnswerRow
  const organization = organizationResult.data as OrganizationRow

  return {
    organizationName: organization.name,
    document,
    answers: normalizeStoredAnswers(answer.values),
    workflowStatus: normalizeWorkflowStatus(answer.workflow_status),
    recipients: (recipientResult.data as DocumentSigningRecipientRow[]).map(
      mapSigningRecipient
    ),
  }
}

/**
 * Builds the token-safe public view for one persisted signing recipient.
 *
 * @param client - Signing persistence client.
 * @param recipient - Recipient loaded through a private token hash.
 * @returns Public signing view without token hashes or co-signer emails.
 * @throws DocumentSigningServiceError when the recipient is no longer attached.
 */
export async function loadPublicSigningView(
  client: SigningServiceClient,
  recipient: DocumentSigningRecipientRow
): Promise<PublicDocumentSigningView> {
  const view = await loadGeneratedDocumentView(
    client,
    recipient.org_id,
    recipient.document_id
  )
  const currentRecipient = view.recipients.find(
    (candidate: DocumentSigningRecipient): boolean =>
      candidate.id === recipient.id
  )

  if (!currentRecipient) {
    throw new DocumentSigningServiceError(
      "Signing recipient was not found.",
      404
    )
  }

  return {
    organizationName: view.organizationName,
    document: view.document,
    answers: view.answers,
    workflowStatus: view.workflowStatus,
    requiresInitials: templateRequiresRecipientInitials(
      view.document.templateSnapshot
    ),
    recipient: {
      id: currentRecipient.id,
      name: currentRecipient.name,
      email: currentRecipient.email,
      requiresSignature: currentRecipient.requiresSignature,
      status: currentRecipient.status,
      tokenExpiresAt: currentRecipient.tokenExpiresAt,
      signedAt: currentRecipient.signedAt,
    },
    signers: view.recipients.map(
      (signer: DocumentSigningRecipient): PublicSignerStatus => ({
        id: signer.id,
        name: signer.name,
        requiresSignature: signer.requiresSignature,
        status: signer.status,
        signedAt: signer.signedAt,
      })
    ),
  }
}

/**
 * Loads one recipient by a non-reversible private token hash.
 *
 * @param client - Signing persistence client.
 * @param tokenHash - SHA-256 token digest.
 * @returns Persisted recipient row.
 * @throws DocumentSigningServiceError when the link is unavailable.
 */
export async function loadRecipientByToken(
  client: SigningServiceClient,
  tokenHash: string
): Promise<DocumentSigningRecipientRow> {
  const { data, error } = await client
    .from("document_signing_recipients")
    .select(RECIPIENT_COLUMNS)
    .eq("token_hash", tokenHash)
    .maybeSingle()

  if (error) {
    throw createDatabaseError(error, "Unable to open signing link.")
  }

  if (!data) {
    throw new DocumentSigningServiceError(
      "This signing link is invalid or no longer available.",
      404
    )
  }

  return data as DocumentSigningRecipientRow
}

/**
 * Atomically merges a member answer patch and returns verified stored values.
 *
 * @param client - Signing persistence client.
 * @param organizationId - Tenant identifier.
 * @param documentId - Generated-document identifier.
 * @param values - Validated answer patch.
 * @returns Stored answer object returned by the database function.
 */
export async function mergeGeneratedDocumentAnswers(
  client: SigningServiceClient,
  organizationId: string,
  documentId: string,
  values: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { data, error } = await client.rpc(
    "merge_generated_document_answers",
    {
      target_org_id: organizationId,
      target_document_id: documentId,
      target_values: values,
    }
  )

  if (error) {
    throw createDatabaseError(error, "Unable to save document answers.")
  }

  return normalizeStoredAnswers(data)
}

/**
 * Inserts validated signing recipient rows and reloads their persisted values.
 *
 * @param client - Signing persistence client.
 * @param rows - Complete recipient rows with hashed private tokens.
 * @returns Created recipient rows.
 */
export async function insertSigningRecipients(
  client: SigningServiceClient,
  rows: DocumentSigningRecipientRow[]
): Promise<DocumentSigningRecipientRow[]> {
  const { data, error } = await client
    .from("document_signing_recipients")
    .insert(rows)
    .select(RECIPIENT_COLUMNS)

  if (error || !data) {
    throw createDatabaseError(error, "Unable to create signing recipients.")
  }

  return data as DocumentSigningRecipientRow[]
}

/**
 * Moves an editable answer row into the awaiting-signatures workflow state.
 *
 * @param client - Signing persistence client.
 * @param organizationId - Tenant identifier.
 * @param documentId - Generated-document identifier.
 * @returns `true` when the answer row changed, otherwise `false` after completion.
 */
export async function startSigningWorkflow(
  client: SigningServiceClient,
  organizationId: string,
  documentId: string
): Promise<boolean> {
  const { data, error } = await client
    .from("document_answers")
    .update({ workflow_status: "awaiting_signatures" })
    .eq("document_id", documentId)
    .eq("org_id", organizationId)
    .neq("workflow_status", "completed")
    .select("document_id")
    .maybeSingle()

  if (error) {
    throw createDatabaseError(error, "Unable to start the signing workflow.")
  }

  return Boolean(data)
}

/**
 * Replaces a pending recipient's private link metadata.
 *
 * @param client - Signing persistence client.
 * @param input - Tenant-scoped recipient and replacement token metadata.
 * @returns Updated recipient row, or `null` after a concurrent state change.
 */
export async function refreshSigningRecipientLink(
  client: SigningServiceClient,
  input: RefreshSigningRecipientLinkInput
): Promise<DocumentSigningRecipientRow | null> {
  const { data, error } = await client
    .from("document_signing_recipients")
    .update({
      token_hash: input.tokenHash,
      token_expires_at: input.tokenExpiresAt,
      invited_at: input.invitedAt,
      status: "pending",
      viewed_at: null,
    })
    .eq("id", input.recipientId)
    .eq("document_id", input.documentId)
    .eq("org_id", input.organizationId)
    .neq("status", "signed")
    .select(RECIPIENT_COLUMNS)
    .maybeSingle()

  if (error) {
    throw createDatabaseError(error, "Unable to refresh signing link.")
  }

  return data as DocumentSigningRecipientRow | null
}

/**
 * Marks a still-pending private recipient link as viewed.
 *
 * @param client - Signing persistence client.
 * @param recipient - Recipient loaded through the matching token hash.
 * @param viewedAt - Validated ISO timestamp.
 * @returns Updated row, or the original row after a concurrent state change.
 */
export async function markSigningRecipientViewed(
  client: SigningServiceClient,
  recipient: DocumentSigningRecipientRow,
  viewedAt: string
): Promise<DocumentSigningRecipientRow> {
  const { data, error } = await client
    .from("document_signing_recipients")
    .update({ status: "viewed", viewed_at: viewedAt })
    .eq("id", recipient.id)
    .eq("token_hash", recipient.token_hash)
    .eq("status", "pending")
    .select(RECIPIENT_COLUMNS)
    .maybeSingle()

  if (error) {
    throw createDatabaseError(error, "Unable to open signing link.")
  }

  return data ? (data as DocumentSigningRecipientRow) : recipient
}

/**
 * Calls the atomic function that stores a public signature and workflow state.
 *
 * @param client - Signing persistence client.
 * @param input - Tenant-scoped recipient, answer patch, and validated drawings.
 * @returns Workflow state returned by the database function.
 */
export async function completeRecipientSignature(
  client: SigningServiceClient,
  input: CompleteRecipientSignatureInput
): Promise<unknown> {
  const { data, error } = await client.rpc(
    "complete_document_recipient_signature",
    {
      target_org_id: input.organizationId,
      target_document_id: input.documentId,
      target_recipient_id: input.recipientId,
      target_token_hash: input.tokenHash,
      target_values: input.values,
      target_signature_data: input.signatureData,
      target_initials_data: input.initialsData,
    }
  )

  if (error) {
    throw createDatabaseError(error, "Unable to complete document signing.")
  }

  return data
}

/**
 * Best-effort cleanup for recipients created before a workflow-state conflict.
 *
 * @param client - Signing persistence client.
 * @param organizationId - Tenant identifier.
 * @param recipientIds - Exact recipient identifiers created by the operation.
 */
export async function cleanupRecipients(
  client: SigningServiceClient,
  organizationId: string,
  recipientIds: string[]
): Promise<void> {
  const { error } = await client
    .from("document_signing_recipients")
    .delete()
    .eq("org_id", organizationId)
    .in("id", recipientIds)

  if (error) {
    console.error("document_signing_recipient_cleanup_failed", {
      organizationId,
      recipientCount: recipientIds.length,
    })
  }
}

/**
 * Maps a signing recipient row without exposing token hashes.
 *
 * @param row - Persisted signing recipient.
 * @returns Member-facing recipient data.
 * @throws DocumentSigningServiceError for an unsupported stored status.
 */
export function mapSigningRecipient(
  row: DocumentSigningRecipientRow
): DocumentSigningRecipient {
  if (
    row.status !== "pending" &&
    row.status !== "viewed" &&
    row.status !== "signed"
  ) {
    throw new DocumentSigningServiceError(
      "Database returned an unsupported recipient status.",
      500
    )
  }

  return {
    id: row.id,
    organizationId: row.org_id,
    documentId: row.document_id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    requiresSignature: row.requires_signature,
    status: row.status,
    tokenExpiresAt: row.token_expires_at,
    invitedAt: row.invited_at,
    viewedAt: row.viewed_at,
    signedAt: row.signed_at,
    signatureDataUrl: getDrawingDataUrl(row.signature_data),
    initialsDataUrl: getDrawingDataUrl(row.initials_data),
  }
}

function mapGeneratedDocument(row: GeneratedDocumentRow): GeneratedDocument {
  return mapGeneratedDocumentRow(row, {
    createUnsupportedSourceError: (): Error =>
      new DocumentSigningServiceError(
        "Uploaded files cannot use the guided signing editor.",
        409
      ),
    parseSnapshot: parseTemplateSnapshot,
  })
}

function parseTemplateSnapshot(value: unknown): TemplateContent {
  try {
    return parseTemplateContent(value)
  } catch {
    throw new DocumentSigningServiceError(
      "Generated document snapshot is invalid.",
      500
    )
  }
}

function normalizeStoredAnswers(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DocumentSigningServiceError(
      "Stored document answers are invalid.",
      500
    )
  }

  return { ...(value as Record<string, unknown>) }
}

function normalizeWorkflowStatus(
  value: string
): GeneratedDocumentWorkflowStatus {
  if (
    value !== "draft" &&
    value !== "awaiting_signatures" &&
    value !== "completed"
  ) {
    throw new DocumentSigningServiceError(
      "Database returned an unsupported workflow status.",
      500
    )
  }

  return value
}
