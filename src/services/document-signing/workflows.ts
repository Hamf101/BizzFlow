import { randomUUID } from "node:crypto"

import type { OrganizationPermissionAction } from "@/lib/permissions"
import {
  sendDocumentSigningEmail as defaultSendDocumentSigningEmail,
  DocumentSigningEmailServiceError,
} from "@/services/document-signing-email-service"
import {
  assertRequiredAnswersComplete,
  collectFields,
  deriveChangedAnswerPatch,
  normalizeAnswerPatch,
  pruneHiddenAnswerPatch,
  pruneHiddenAnswerValues,
  templateRequiresRecipientInitials,
} from "@/services/document-signing/answer-validation"
import type {
  CompletePublicDocumentSigningInput,
  DocumentSigningServiceDeps,
  GetGeneratedDocumentSigningViewInput,
  GetPublicDocumentSigningViewInput,
  ResendDocumentSigningInvitationInput,
  SaveGeneratedDocumentAnswersInput,
  SendDocumentForSigningInput,
  SigningServiceClient,
  UpdateGeneratedDocumentContentInput,
} from "@/services/document-signing/contracts"
import {
  normalizeOptionalDrawing,
  normalizeRequiredDrawing,
} from "@/services/document-signing/drawing-validation"
import {
  createDatabaseError,
  DocumentSigningServiceError,
  runSigningOperation,
} from "@/services/document-signing/errors"
import {
  cleanupRecipients,
  completeRecipientSignature,
  insertSigningRecipients,
  loadGeneratedDocumentView,
  loadPublicSigningView,
  loadRecipientByToken,
  mapSigningRecipient,
  markSigningRecipientViewed,
  mergeGeneratedDocumentAnswers,
  refreshSigningRecipientLink,
  resolveSigningClient,
  startSigningWorkflow,
} from "@/services/document-signing/persistence"
import { requireDocumentAccess } from "@/services/documents/access-service"
import { DocumentServiceError } from "@/services/documents/errors"
import type { DocumentAccessLevel } from "@/types/document"
import {
  assertNewRecipientEmails,
  normalizeRecipientInputs,
} from "@/services/document-signing/recipient-validation"
import {
  assertRecipientLinkUsable,
  assertSecureToken,
  createSecureToken,
  getSigningNow,
  hashToken,
  normalizeToken,
  TOKEN_LIFETIME_MS,
} from "@/services/document-signing/token-security"
import type {
  DocumentSigningRecipient,
  GeneratedDocumentSigningView,
  PublicDocumentSigningView,
  PublicSignerStatus,
  SendDocumentForSigningResult,
} from "@/types/signing"
import {
  MAX_TEMPLATE_CONTENT_JSON_LENGTH,
  parseTemplateContent,
  type DocumentSigningRecipientRow,
  type TemplateContent,
} from "@/types/template"

const SIGNED_ANSWERS_MESSAGE =
  "Someone has already signed. Send it again to change the answers."

type PendingInvitation = {
  id: string
  token: string
  row: DocumentSigningRecipientRow
}

type SigningDocumentStateRow = {
  lifecycle_state?: unknown
  archived_at?: unknown
}

/**
 * Loads a generated document, shared answers, and recipients for a member.
 *
 * @param input - Actor, organization, and document identifiers.
 * @param deps - Optional injected database dependency for tests.
 * @returns Full member-facing generated document state.
 * @throws DocumentSigningServiceError when access or data loading fails.
 */
export async function getGeneratedDocumentSigningView(
  input: GetGeneratedDocumentSigningViewInput,
  deps: DocumentSigningServiceDeps = {}
): Promise<GeneratedDocumentSigningView> {
  return runSigningOperation(
    "get_generated_document_signing_view",
    input,
    async (): Promise<GeneratedDocumentSigningView> => {
      const client = resolveSigningClient(deps.client)

      const accessLevel = await requireMemberDocumentAccess(
        client,
        input.organizationId,
        input.documentId,
        input.actorUserId,
        "viewer",
        "read",
        "documents:view",
        "You cannot view this document."
      )
      await requireMemberSigningDocumentLifecycle(
        client,
        input.organizationId,
        input.documentId,
        "read",
        "Archived documents cannot be changed."
      )
      const view = await loadGeneratedDocumentView(
        client,
        input.organizationId,
        input.documentId
      )

      return { ...view, accessLevel }
    }
  )
}

/**
 * Saves a member's validated answer patch while a document remains editable.
 *
 * @param input - Actor, generated document, and answer patch.
 * @param deps - Optional injected database dependency for tests.
 * @returns Updated member-facing generated document state.
 * @throws DocumentSigningServiceError for invalid fields, access, or completion.
 */
export async function saveGeneratedDocumentAnswers(
  input: SaveGeneratedDocumentAnswersInput,
  deps: DocumentSigningServiceDeps = {}
): Promise<GeneratedDocumentSigningView> {
  return runSigningOperation(
    "save_generated_document_answers",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      documentId: input.documentId,
    },
    async (): Promise<GeneratedDocumentSigningView> => {
      const client = resolveSigningClient(deps.client)

      await requireMemberDocumentAccess(
        client,
        input.organizationId,
        input.documentId,
        input.actorUserId,
        "contributor",
        "mutation",
        "documents:fill",
        "You cannot fill this document."
      )
      await requireMemberSigningDocumentLifecycle(
        client,
        input.organizationId,
        input.documentId,
        "mutation",
        "Archived documents cannot be changed."
      )
      const view = await loadGeneratedDocumentView(
        client,
        input.organizationId,
        input.documentId
      )

      if (view.workflowStatus === "completed") {
        throw new DocumentSigningServiceError(
          "Completed documents cannot be changed.",
          409
        )
      }

      // A signature stands for the answers as they were signed, so the last
      // word belongs to the signers from here on.
      if (
        view.recipients.some(
          (recipient: DocumentSigningRecipient): boolean =>
            recipient.status === "signed"
        )
      ) {
        throw new DocumentSigningServiceError(SIGNED_ANSWERS_MESSAGE, 409)
      }

      const content = view.document.templateSnapshot
      const normalizedPatch = await normalizeAnswerPatch(
        collectFields(content),
        input.values
      )
      const visiblePatch = pruneHiddenAnswerPatch(
        content,
        view.answers,
        normalizedPatch
      )
      const persistedValues = await mergeGeneratedDocumentAnswers(
        client,
        input.organizationId,
        input.documentId,
        visiblePatch
      )

      for (const [fieldKey, value] of Object.entries(visiblePatch)) {
        if (!Object.is(persistedValues[fieldKey], value)) {
          throw new DocumentSigningServiceError(
            "Saved document answers could not be verified.",
            500
          )
        }
      }

      return loadGeneratedDocumentView(
        client,
        input.organizationId,
        input.documentId
      )
    }
  )
}

/**
 * Saves a draft's own title and page. Content can change only until the
 * document is sent for signing, so every signer sees what they were sent, and
 * only from the latest copy, so a save never overwrites someone else's.
 *
 * @param input - Actor, document, the version the editor holds, and the page.
 * @param deps - Optional injected database dependency for tests.
 * @returns The saved title and the version to save from next.
 * @throws DocumentSigningServiceError for access, a sent document, a stale
 *   copy, or invalid content.
 */
export async function updateGeneratedDocumentContent(
  input: UpdateGeneratedDocumentContentInput,
  deps: DocumentSigningServiceDeps = {}
): Promise<{ title: string; updatedAt: string }> {
  return runSigningOperation(
    "update_generated_document_content",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      documentId: input.documentId,
    },
    async (): Promise<{ title: string; updatedAt: string }> => {
      const client = resolveSigningClient(deps.client)

      await requireMemberDocumentAccess(
        client,
        input.organizationId,
        input.documentId,
        input.actorUserId,
        "contributor",
        "mutation",
        "documents:fill",
        "You cannot edit this document."
      )
      await requireMemberSigningDocumentLifecycle(
        client,
        input.organizationId,
        input.documentId,
        "mutation",
        "Archived documents cannot be changed."
      )

      const title = input.title.trim()
      const content = parseDocumentContent(input.content)

      if (title.length === 0 || title.length > 180) {
        throw new DocumentSigningServiceError(
          "Give the document a title of up to 180 characters.",
          400
        )
      }

      const view = await loadGeneratedDocumentView(
        client,
        input.organizationId,
        input.documentId
      )

      if (view.workflowStatus !== "draft" || view.recipients.length > 0) {
        throw new DocumentSigningServiceError(
          "This document was sent for signing, so its content can no longer change.",
          409
        )
      }

      const { data, error } = await client
        .from("documents")
        .update({
          title,
          template_snapshot: content,
          updated_by: input.actorUserId,
        })
        .eq("id", input.documentId)
        .eq("org_id", input.organizationId)
        .eq("updated_at", input.expectedUpdatedAt)
        .select("updated_at")
        .maybeSingle()

      if (error) {
        throw createDatabaseError(error, "Unable to save the document.")
      }

      if (!data) {
        throw new DocumentSigningServiceError(
          "This document changed since it was opened. Reload to see the latest version.",
          409
        )
      }

      return { title, updatedAt: String((data as { updated_at: unknown }).updated_at) }
    }
  )
}

/**
 * Keeps a signature meaningful: once anyone has signed, an answer that already
 * had a value stays as it was signed. Whoever signs next may still fill what
 * was left empty.
 *
 * @param view - Every signer's status and the answers as stored.
 * @param recipientId - The signer submitting these answers.
 * @param patch - The answers they would change.
 * @throws DocumentSigningServiceError when a signed answer would change.
 */
function assertSignedAnswersUnchanged(
  view: {
    answers: Record<string, unknown>
    signers: readonly PublicSignerStatus[]
  },
  recipientId: string,
  patch: Record<string, unknown>
): void {
  const signedAlready = view.signers.some(
    (signer: PublicSignerStatus): boolean =>
      signer.id !== recipientId && signer.status === "signed"
  )

  if (!signedAlready) {
    return
  }

  const rewritesSigned = Object.entries(patch).some(
    ([fieldKey, value]: [string, unknown]): boolean => {
      const signedValue = view.answers[fieldKey]

      return (
        signedValue !== undefined &&
        signedValue !== null &&
        signedValue !== "" &&
        !Object.is(signedValue, value)
      )
    }
  )

  if (rewritesSigned) {
    throw new DocumentSigningServiceError(SIGNED_ANSWERS_MESSAGE, 409)
  }
}

function parseDocumentContent(value: unknown): TemplateContent {
  if (JSON.stringify(value ?? null).length > MAX_TEMPLATE_CONTENT_JSON_LENGTH) {
    throw new DocumentSigningServiceError("The document is too large to save.", 400)
  }

  try {
    return parseTemplateContent(value)
  } catch {
    throw new DocumentSigningServiceError("The document content is invalid.", 400)
  }
}

/**
 * Creates unordered signing recipients and emails each a private expiring link.
 *
 * @param input - Actor, generated document, and recipient collection.
 * @param deps - Optional id, token, clock, database, and email dependencies.
 * @returns Created recipients after EmailJS accepts every invitation.
 * @throws DocumentSigningServiceError for invalid recipients, state, or delivery.
 */
export async function sendDocumentForSigning(
  input: SendDocumentForSigningInput,
  deps: DocumentSigningServiceDeps = {}
): Promise<SendDocumentForSigningResult> {
  return runSigningOperation(
    "send_document_for_signing",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      documentId: input.documentId,
      recipientCount: input.recipients.length,
    },
    async (): Promise<SendDocumentForSigningResult> => {
      const client = resolveSigningClient(deps.client)

      await requireMemberDocumentAccess(
        client,
        input.organizationId,
        input.documentId,
        input.actorUserId,
        "contributor",
        "mutation",
        "documents:send",
        "You cannot send documents for signing."
      )
      await requireMemberSigningDocumentLifecycle(
        client,
        input.organizationId,
        input.documentId,
        "mutation",
        "Archived documents cannot be sent for signing."
      )
      const view = await loadGeneratedDocumentView(
        client,
        input.organizationId,
        input.documentId
      )

      if (view.workflowStatus === "completed") {
        throw new DocumentSigningServiceError(
          "Completed documents cannot be sent again.",
          409
        )
      }

      const recipients = normalizeRecipientInputs(input.recipients)
      assertNewRecipientEmails(view.recipients, recipients)
      const now = getSigningNow(deps.now)
      const expiresAt = new Date(now.getTime() + TOKEN_LIFETIME_MS).toISOString()
      const createId = deps.createId ?? randomUUID
      const createToken = deps.createToken ?? createSecureToken
      const pendingInvitations = recipients.map(
        (recipient): PendingInvitation => {
          const id = createId()
          const token = createToken()

          assertSecureToken(token)
          return {
            id,
            token,
            row: {
              id,
              org_id: input.organizationId,
              document_id: input.documentId,
              user_id: recipient.userId,
              name: recipient.name,
              email: recipient.email,
              requires_signature: recipient.requiresSignature,
              status: "pending",
              token_hash: hashToken(token),
              token_expires_at: expiresAt,
              invited_at: now.toISOString(),
              viewed_at: null,
              signed_at: null,
              signature_data: null,
              initials_data: null,
            },
          }
        }
      )
      const createdRows = await insertSigningRecipients(
        client,
        pendingInvitations.map(
          (invitation: PendingInvitation): DocumentSigningRecipientRow =>
            invitation.row
        )
      )

      let workflowStarted: boolean

      try {
        workflowStarted = await startSigningWorkflow(
          client,
          input.organizationId,
          input.documentId
        )
      } catch (error: unknown) {
        await cleanupRecipients(
          client,
          input.organizationId,
          pendingInvitations.map(
            (invitation: PendingInvitation): string => invitation.id
          )
        )
        throw error
      }

      if (!workflowStarted) {
        await cleanupRecipients(
          client,
          input.organizationId,
          pendingInvitations.map(
            (invitation: PendingInvitation): string => invitation.id
          )
        )
        throw new DocumentSigningServiceError(
          "The document completed before signing invitations could be added.",
          409
        )
      }

      const createdById = new Map<string, DocumentSigningRecipientRow>(
        createdRows.map(
          (
            row: DocumentSigningRecipientRow
          ): [string, DocumentSigningRecipientRow] => [row.id, row]
        )
      )
      const sendEmail =
        deps.sendDocumentSigningEmail ?? defaultSendDocumentSigningEmail
      const deliveries = await Promise.allSettled(
        pendingInvitations.map(
          async (invitation: PendingInvitation): Promise<void> => {
            const recipient = createdById.get(invitation.id)

            if (!recipient) {
              throw new DocumentSigningServiceError(
                "A created recipient could not be loaded.",
                500
              )
            }

            await sendEmail({
              documentId: input.documentId,
              documentTitle: view.document.title,
              organizationName: view.organizationName,
              recipientEmail: recipient.email,
              recipientId: recipient.id,
              recipientName: recipient.name,
              token: invitation.token,
            })
          }
        )
      )
      const failedDeliveries = deliveries.filter(
        (delivery): boolean => delivery.status === "rejected"
      ).length

      if (failedDeliveries > 0) {
        console.warn("document_signing_email_batch_incomplete", {
          organizationId: input.organizationId,
          documentId: input.documentId,
          recipientCount: createdRows.length,
          failedDeliveries,
        })
        throw new DocumentSigningServiceError(
          "Some signing emails could not be delivered. The recipients were saved so you can resend them.",
          502
        )
      }

      return {
        documentId: input.documentId,
        workflowStatus: "awaiting_signatures",
        recipients: createdRows.map(mapSigningRecipient),
      }
    }
  )
}

/**
 * Generates a replacement private link and emails it to one pending recipient.
 *
 * @param input - Actor, generated document, and recipient identifiers.
 * @param deps - Optional token, clock, database, and email dependencies.
 * @returns Updated recipient without its private token hash.
 * @throws DocumentSigningServiceError for access, state, or delivery failures.
 */
export async function resendDocumentSigningInvitation(
  input: ResendDocumentSigningInvitationInput,
  deps: DocumentSigningServiceDeps = {}
): Promise<DocumentSigningRecipient> {
  return runSigningOperation(
    "resend_document_signing_invitation",
    input,
    async (): Promise<DocumentSigningRecipient> => {
      const client = resolveSigningClient(deps.client)

      await requireMemberDocumentAccess(
        client,
        input.organizationId,
        input.documentId,
        input.actorUserId,
        "contributor",
        "mutation",
        "documents:send",
        "You cannot send documents for signing."
      )
      await requireMemberSigningDocumentLifecycle(
        client,
        input.organizationId,
        input.documentId,
        "mutation",
        "Archived documents cannot be sent for signing."
      )
      const view = await loadGeneratedDocumentView(
        client,
        input.organizationId,
        input.documentId
      )
      const recipient = view.recipients.find(
        (candidate: DocumentSigningRecipient): boolean =>
          candidate.id === input.recipientId
      )

      if (!recipient) {
        throw new DocumentSigningServiceError(
          "Signing recipient was not found.",
          404
        )
      }

      if (recipient.status === "signed" || view.workflowStatus === "completed") {
        throw new DocumentSigningServiceError(
          "Completed signing invitations cannot be resent.",
          409
        )
      }

      const token = (deps.createToken ?? createSecureToken)()
      assertSecureToken(token)
      const now = getSigningNow(deps.now)
      const updatedRecipient = await refreshSigningRecipientLink(client, {
        recipientId: input.recipientId,
        documentId: input.documentId,
        organizationId: input.organizationId,
        tokenHash: hashToken(token),
        tokenExpiresAt: new Date(
          now.getTime() + TOKEN_LIFETIME_MS
        ).toISOString(),
        invitedAt: now.toISOString(),
      })

      if (!updatedRecipient) {
        throw new DocumentSigningServiceError(
          "Signing recipient changed before the link could be refreshed.",
          409
        )
      }

      const sendEmail =
        deps.sendDocumentSigningEmail ?? defaultSendDocumentSigningEmail

      try {
        await sendEmail({
          documentId: input.documentId,
          documentTitle: view.document.title,
          organizationName: view.organizationName,
          recipientEmail: updatedRecipient.email,
          recipientId: updatedRecipient.id,
          recipientName: updatedRecipient.name,
          token,
        })
      } catch (error: unknown) {
        if (error instanceof DocumentSigningEmailServiceError) {
          throw new DocumentSigningServiceError(error.message, error.statusCode)
        }

        throw error
      }

      return mapSigningRecipient(updatedRecipient)
    }
  )
}

/**
 * Loads a generated document through a valid private recipient token.
 *
 * @param input - Raw URL token kept out of persistence and logs.
 * @param deps - Optional clock and database dependencies for tests.
 * @returns Public signing state with no token hashes or co-signer emails.
 * @throws DocumentSigningServiceError when the link is invalid or expired.
 */
export async function getPublicDocumentSigningView(
  input: GetPublicDocumentSigningViewInput,
  deps: DocumentSigningServiceDeps = {}
): Promise<PublicDocumentSigningView> {
  return runSigningOperation(
    "get_public_document_signing_view",
    {},
    async (): Promise<PublicDocumentSigningView> => {
      const client = resolveSigningClient(deps.client)
      const token = normalizeToken(input.token)
      const recipient = await loadRecipientByToken(client, hashToken(token))
      assertRecipientLinkUsable(recipient, getSigningNow(deps.now))
      // Checked before the link is marked viewed, which an inactive document
      // refuses in the database.
      await requirePublicSigningDocumentLifecycle(client, recipient, "read")

      const currentRecipient =
        recipient.status === "pending"
          ? await markSigningRecipientViewed(
              client,
              recipient,
              getSigningNow(deps.now).toISOString()
            )
          : recipient

      return loadPublicSigningView(client, currentRecipient)
    }
  )
}

/**
 * Atomically merges final answers, records a drawn signature, and completes the
 * workflow only when every required recipient has signed in any order.
 *
 * @param input - Private token, answer patch, and basic drawings.
 * @param deps - Optional clock and database dependencies for tests.
 * @returns Updated public signing view.
 * @throws DocumentSigningServiceError for invalid fields, links, or state.
 */
export async function completePublicDocumentSigning(
  input: CompletePublicDocumentSigningInput,
  deps: DocumentSigningServiceDeps = {}
): Promise<PublicDocumentSigningView> {
  return runSigningOperation(
    "complete_public_document_signing",
    {},
    async (): Promise<PublicDocumentSigningView> => {
      const client = resolveSigningClient(deps.client)
      const token = normalizeToken(input.token)
      const tokenHash = hashToken(token)
      const recipient = await loadRecipientByToken(client, tokenHash)
      assertRecipientLinkUsable(recipient, getSigningNow(deps.now))
      // A signed recipient may still read the document; signing needs it active.
      await requirePublicSigningDocumentLifecycle(
        client,
        recipient,
        recipient.status === "signed" ? "read" : "mutation"
      )

      if (recipient.status === "signed") {
        return loadPublicSigningView(client, recipient)
      }

      const view = await loadPublicSigningView(client, recipient)
      const isLastRequiredRecipient = view.signers.every(
        (signer: PublicSignerStatus): boolean =>
          signer.id === recipient.id ||
          !signer.requiresSignature ||
          signer.status === "signed"
      )
      const fieldByKey = collectFields(view.document.templateSnapshot)
      const submittedValues = await normalizeAnswerPatch(fieldByKey, input.values)
      const baselineValues =
        input.baselineValues === undefined
          ? undefined
          : await normalizeAnswerPatch(fieldByKey, input.baselineValues)
      const changedAnswerPatch = deriveChangedAnswerPatch(
        submittedValues,
        baselineValues
      )
      const answerPatch = pruneHiddenAnswerPatch(
        view.document.templateSnapshot,
        view.answers,
        changedAnswerPatch
      )
      assertSignedAnswersUnchanged(view, recipient.id, answerPatch)
      const effectiveValues = pruneHiddenAnswerValues(
        view.document.templateSnapshot,
        { ...view.answers, ...answerPatch }
      )
      assertRequiredAnswersComplete(
        view.document.templateSnapshot,
        fieldByKey,
        effectiveValues,
        isLastRequiredRecipient
      )
      const requiresInitials = templateRequiresRecipientInitials(
        view.document.templateSnapshot,
        effectiveValues
      )
      const [signatureData, initialsData] = await Promise.all([
        recipient.requires_signature
          ? normalizeRequiredDrawing(input.signatureDataUrl, "signature")
          : normalizeOptionalDrawing(input.signatureDataUrl, "signature"),
        requiresInitials
          ? normalizeRequiredDrawing(
              input.initialsDataUrl ?? null,
              "initials acknowledgement"
            )
          : normalizeOptionalDrawing(
              input.initialsDataUrl ?? null,
              "initials acknowledgement"
            ),
      ])
      const workflowStatus = await completeRecipientSignature(client, {
        organizationId: recipient.org_id,
        documentId: recipient.document_id,
        recipientId: recipient.id,
        tokenHash,
        values: answerPatch,
        signatureData,
        initialsData,
      })

      if (
        workflowStatus !== "awaiting_signatures" &&
        workflowStatus !== "completed"
      ) {
        throw new DocumentSigningServiceError(
          "Signing completed with an invalid workflow state.",
          500
        )
      }

      const updatedRecipient = await loadRecipientByToken(client, tokenHash)
      return loadPublicSigningView(client, updatedRecipient)
    }
  )
}

async function requireMemberDocumentAccess(
  client: SigningServiceClient,
  organizationId: string,
  documentId: string,
  actorUserId: string,
  requiredAccess: DocumentAccessLevel,
  operation: "read" | "mutation",
  organizationAction: OrganizationPermissionAction,
  rejectionMessage: string
): Promise<DocumentAccessLevel> {
  try {
    return await requireDocumentAccess(
      {
        organizationId,
        documentId,
        actorUserId,
        requiredAccess,
        operation,
        requiredOrganizationPermissionAction: organizationAction,
      },
      client
    )
  } catch (error: unknown) {
    if (error instanceof DocumentServiceError) {
      throw new DocumentSigningServiceError(
        error.statusCode === 403 ? rejectionMessage : error.message,
        error.statusCode
      )
    }

    throw error
  }
}

async function requireMemberSigningDocumentLifecycle(
  client: SigningServiceClient,
  organizationId: string,
  documentId: string,
  operation: "read" | "mutation",
  inactiveMessage: string
): Promise<void> {
  await requireSigningDocumentLifecycle(
    client,
    organizationId,
    documentId,
    operation,
    { inactive: inactiveMessage, unavailable: "Generated document was not found." }
  )
}

// A private link obeys the member lifecycle rule, but a removed document must
// look exactly like an invalid link, so its holder learns nothing more.
async function requirePublicSigningDocumentLifecycle(
  client: SigningServiceClient,
  recipient: { document_id: string; org_id: string },
  operation: "read" | "mutation"
): Promise<void> {
  await requireSigningDocumentLifecycle(
    client,
    recipient.org_id,
    recipient.document_id,
    operation,
    {
      inactive: "This document is no longer accepting signatures.",
      unavailable: "This signing link is invalid or no longer available.",
    }
  )
}

// Trash and pending purge revoke every read. An archived document stays
// readable but accepts no mutation, which the database also enforces.
async function requireSigningDocumentLifecycle(
  client: SigningServiceClient,
  organizationId: string,
  documentId: string,
  operation: "read" | "mutation",
  messages: { inactive: string; unavailable: string }
): Promise<void> {
  const { data, error } = await client
    .from("documents")
    .select("lifecycle_state,archived_at")
    .eq("id", documentId)
    .eq("org_id", organizationId)
    .maybeSingle()

  if (error) {
    throw createDatabaseError(error, "Unable to load generated document.")
  }

  const lifecycleState = data
    ? normalizeSigningDocumentLifecycle(data as SigningDocumentStateRow)
    : null

  if (
    lifecycleState === null ||
    lifecycleState === "trashed" ||
    lifecycleState === "purge_pending"
  ) {
    throw new DocumentSigningServiceError(messages.unavailable, 404)
  }

  if (operation === "mutation" && lifecycleState !== "active") {
    throw new DocumentSigningServiceError(messages.inactive, 409)
  }
}

function normalizeSigningDocumentLifecycle(
  document: SigningDocumentStateRow
): "active" | "archived" | "trashed" | "purge_pending" {
  const lifecycleState = document.lifecycle_state

  if (
    lifecycleState === "active" ||
    lifecycleState === "archived" ||
    lifecycleState === "trashed" ||
    lifecycleState === "purge_pending"
  ) {
    return lifecycleState
  }

  if (lifecycleState === undefined || lifecycleState === null) {
    return document.archived_at == null ? "active" : "archived"
  }

  throw new DocumentSigningServiceError(
    "Database returned an unsupported document lifecycle state.",
    500
  )
}
