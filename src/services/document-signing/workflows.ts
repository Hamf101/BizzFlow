import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"

import type { OrganizationPermissionAction } from "@/lib/permissions"
import { recordAuditLogBestEffort } from "@/services/audit-service"
import {
  sendDocumentSigningCancelledEmail as defaultSendDocumentSigningCancelledEmail,
  sendDocumentSigningDeclinedEmail as defaultSendDocumentSigningDeclinedEmail,
  sendDocumentSigningEmail as defaultSendDocumentSigningEmail,
  DocumentSigningEmailServiceError,
} from "@/services/document-signing-email-service"
import {
  assertRequiredAnswersComplete,
  calculationBase,
  collectFields,
  deriveChangedAnswerPatch,
  keepValidAnswers,
  normalizeAnswerPatch,
  pruneHiddenAnswerPatch,
  withCalculatedAnswers,
  pruneHiddenAnswerValues,
  templateRequiresRecipientInitials,
} from "@/services/document-signing/answer-validation"
import type {
  CompletePublicDocumentSigningInput,
  DeclinePublicDocumentSigningInput,
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
import { loadProfileEmail } from "@/services/document-signing/signed-copies"
import { MAX_ATTEMPTS, waitBeforeRetry } from "@/services/serialization-retry"
import {
  CHANGED_ANSWERS_MESSAGE,
  createDatabaseError,
  DocumentSigningServiceError,
  runSigningOperation,
} from "@/services/document-signing/errors"
import {
  cancelSigningWorkflow,
  cleanupRecipients,
  completeRecipientSignature,
  declineSigningWorkflow,
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
  toPublicSignerStatus,
} from "@/services/document-signing/persistence"
import {
  requireDocumentAccess,
  requireDocumentReader,
  requireDocumentWriter,
  requireReadableDocument,
  requireDocumentAccessAs,
} from "@/services/documents/access-service"
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
  MemberDocumentSigningView,
  PublicDocumentSigningView,
  PublicSignerStatus,
  SendDocumentForSigningResult,
} from "@/types/signing"
import { boxSigner } from "@/types/box-signers"
import {
  MAX_TEMPLATE_CONTENT_JSON_LENGTH,
  parseTemplateContent,
  type DocumentSigningRecipientRow,
  type TemplateContent,
} from "@/types/template"
import { getVisibleTemplateBlocks } from "@/types/template-visibility"
import { requireStoredImages, TemplateImageServiceError } from "@/services/template-image-service"
import { withoutImageUrls } from "@/types/template-images"

const SIGNED_ANSWERS_MESSAGE =
  "Someone has already signed. Send it again to change the answers."

type PendingInvitation = {
  id: string
  token: string
  row: DocumentSigningRecipientRow
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

      const { accessLevel, guest } = await asSigningError(
        requireDocumentReader(input, client),
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

      return guest ? toGuestView({ ...view, accessLevel }) : { ...view, accessLevel }
    }
  )
}

// Someone outside the workspace sees the document as its paper shows it: not
// where it is filed or who made it, and its signers only as a signing link
// shows its co-signers.
function toGuestView(view: MemberDocumentSigningView): GeneratedDocumentSigningView {
  return {
    ...view,
    document: { ...view.document, createdBy: null, folderId: null, templateId: null, templateRevision: null, updatedBy: null },
    guest: true,
    recipients: view.recipients.map(toPublicSignerStatus),
  }
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

      await asSigningError(requireDocumentWriter(input, client), "You cannot fill this document.")
      await requireMemberSigningDocumentLifecycle(
        client,
        input.organizationId,
        input.documentId,
        "mutation",
        "Archived documents cannot be changed."
      )
      return retryOnChangedAnswers(async (): Promise<GeneratedDocumentSigningView> => {
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
          input.values,
          { sent: view.workflowStatus !== "draft" || view.recipients.length > 0 }
        )
        const visiblePatch = withCalculatedAnswers(
          content,
          view.answers,
          pruneHiddenAnswerPatch(content, view.answers, normalizedPatch)
        )
        const persistedValues = await mergeGeneratedDocumentAnswers(
          client,
          input.organizationId,
          input.documentId,
          visiblePatch,
          calculationBase(content, view.answers)
        )

        for (const [fieldKey, value] of Object.entries(visiblePatch)) {
          if (!isDeepStrictEqual(persistedValues[fieldKey], value)) {
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
      })
    }
  )
}

/**
 * Fills a document with answers read off a form Flow recreated it from. Each
 * answer its field refuses is dropped, never the rest, and those left are
 * saved as the member's own save saves them: pruned, calculated, and refused
 * once the document is done or someone has signed.
 *
 * @param input - Actor, generated document, and the untrusted answers.
 * @param deps - Optional injected database dependency for tests.
 * @returns The document as it stands after the save, and how many answers did and didn't fit.
 * @throws DocumentSigningServiceError for access, a done or signed document, or answers that are not an object.
 */
export async function fillGeneratedDocumentAnswers(
  input: GetGeneratedDocumentSigningViewInput & { answers: unknown },
  deps: DocumentSigningServiceDeps = {}
): Promise<{ dropped: number; kept: number; view: GeneratedDocumentSigningView }> {
  const { actorUserId, documentId, organizationId } = input

  return runSigningOperation("fill_generated_document_answers", { actorUserId, documentId, organizationId }, async () => {
    if (!input.answers || typeof input.answers !== "object" || Array.isArray(input.answers)) {
      throw new DocumentSigningServiceError("Document answers must be a JSON object.", 400)
    }

    const view = await getGeneratedDocumentSigningView({ actorUserId, documentId, organizationId }, deps)
    const content = view.document.templateSnapshot
    // Counted as the save will keep them: an answer the page's own answers hide is pruned.
    const values = pruneHiddenAnswerPatch(content, view.answers, await keepValidAnswers(collectFields(content), input.answers as Record<string, unknown>))
    const kept = Object.keys(values).length

    // Saved even when none fit, so its refusals still answer.
    return {
      dropped: Object.keys(input.answers).length - kept,
      kept,
      view: await saveGeneratedDocumentAnswers({ actorUserId, documentId, organizationId, values }, deps),
    }
  })
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

      await asSigningError(requireDocumentWriter(input, client), "You cannot edit this document.")
      await requireMemberSigningDocumentLifecycle(
        client,
        input.organizationId,
        input.documentId,
        "mutation",
        "Archived documents cannot be changed."
      )

      const title = input.title.trim()
      const content = withoutImageUrls(parseDocumentContent(input.content))

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

      await requireStoredImages(content, view.document.templateSnapshot, input.organizationId).catch((error: unknown) => {
        // A picture that didn't finish uploading is the author's to fix, not a fault here.
        throw error instanceof TemplateImageServiceError
          ? new DocumentSigningServiceError(error.message, error.statusCode)
          : error
      })

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
 * Refuses to send while a required box of the sender's has no drawing, or a
 * signature or initials box is assigned to a signer beyond those the document
 * will have, so no box waits for no one.
 *
 * @param content - The document's page.
 * @param answers - Its answers, which hold the sender's drawings.
 * @param signerCount - Signers the document has once these are added.
 * @throws DocumentSigningServiceError naming the first box that is not ready.
 */
function assertBoxesReadyToSend(
  content: TemplateContent,
  answers: Record<string, unknown>,
  signerCount: number
): void {
  for (const block of getVisibleTemplateBlocks(content, answers)) {
    if (
      (block.type === "signature_field" || block.type === "initials_field") &&
      block.required &&
      boxSigner(block) === "sender" &&
      !answers[block.fieldKey]
    ) {
      throw new DocumentSigningServiceError(`Sign "${block.label}" before sending.`, 400)
    }
  }

  const needed = Math.max(
    0,
    ...content.blocks.map((block): number => {
      const signer = block.type === "signature_field" || block.type === "initials_field" ? boxSigner(block) : 0

      return signer === "sender" ? 0 : signer
    })
  )

  if (needed > signerCount) {
    throw new DocumentSigningServiceError(
      `This document has a box for Signer ${needed}. Add at least ${needed} signers to send it.`,
      400
    )
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
 * @returns Created recipients, and how many of their emails could not be sent.
 * @throws DocumentSigningServiceError for invalid recipients or state, before anything is saved.
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
      assertBoxesReadyToSend(
        view.document.templateSnapshot,
        view.answers,
        view.recipients.length + recipients.length
      )
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
              sent_by: input.actorUserId,
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
      }

      // The round is saved and out for signing either way; an email that did
      // not go is counted, not thrown, so no one sends the document again.
      return {
        documentId: input.documentId,
        workflowStatus: "awaiting_signatures",
        recipients: createdRows.map(mapSigningRecipient),
        undelivered: failedDeliveries,
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
 * Takes a document awaiting signatures back to an editable draft, so its
 * sender can change it and send it again. Every signer's link stops working
 * and every signature so far stops counting: each was given for the words as
 * they stood. The answers stay, since nothing records who typed which; each
 * signer is told by email, best effort, as the cancel has already happened.
 *
 * @param input - Actor, organization, and document identifiers.
 * @param deps - Optional database, clock, audit, and email dependencies.
 * @returns How many signatures were cancelled.
 * @throws DocumentSigningServiceError: 403 without send and fill rights, 404
 *   for a document they cannot open, 409 once completed or when not sent.
 */
export async function cancelDocumentSigning(
  input: GetGeneratedDocumentSigningViewInput,
  deps: DocumentSigningServiceDeps = {}
): Promise<{ cancelledSignatures: number }> {
  return runSigningOperation("cancel_document_signing", input, async () => {
    const client = resolveSigningClient(deps.client)
    const { actorUserId, documentId, organizationId } = input

    // Whoever may send it may take it back, and only to edit it.
    await requireMemberDocumentAccess(client, organizationId, documentId, actorUserId, "contributor", "mutation", "documents:send", "You cannot send documents for signing.")
    await requireMemberDocumentAccess(client, organizationId, documentId, actorUserId, "contributor", "mutation", "documents:fill", "You cannot edit this document.")
    await requireMemberSigningDocumentLifecycle(client, organizationId, documentId, "mutation", "Archived documents cannot be changed.")
    const view = await loadGeneratedDocumentView(client, organizationId, documentId)

    if (view.workflowStatus === "completed") {
      throw new DocumentSigningServiceError("Completed documents cannot be changed. Edit a copy instead.", 409)
    }

    if (view.workflowStatus !== "awaiting_signatures") {
      throw new DocumentSigningServiceError("This document is not waiting for signatures.", 409)
    }

    const revoked = await cancelSigningWorkflow(client, organizationId, documentId)
    const cancelledSignatures = revoked.filter((recipient) => recipient.status === "signed").length
    const revokedAt = getSigningNow(deps.now).toISOString()

    await recordAuditLogBestEffort(
      {
        organizationId,
        actorUserId,
        action: "document.signing_cancelled",
        targetType: "document",
        targetId: documentId,
        metadata: { cancelledSignatures, revokedLinks: revoked.length },
      },
      deps.recordAuditLog
    )

    const sendEmail = deps.sendDocumentSigningCancelledEmail ?? defaultSendDocumentSigningCancelledEmail
    const deliveries = await Promise.allSettled(
      revoked.map((recipient) =>
        sendEmail({
          documentId,
          documentTitle: view.document.title,
          organizationName: view.organizationName,
          recipientEmail: recipient.email,
          recipientId: recipient.id,
          recipientName: recipient.name,
          revokedAt,
          signed: recipient.status === "signed",
        })
      )
    )
    const failedDeliveries = deliveries.filter((delivery) => delivery.status === "rejected").length

    if (failedDeliveries > 0) {
      console.warn("document_signing_cancelled_email_incomplete", { organizationId, documentId, failedDeliveries })
    }

    return { cancelledSignatures }
  })
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
      // ESIGN-style consent comes first: without it nothing is read or signed.
      if (input.consented !== true) {
        throw new DocumentSigningServiceError("Agree to sign electronically to sign.", 400)
      }

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

      return retryOnChangedAnswers(async (): Promise<PublicDocumentSigningView> => {
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
        const answerPatch = withCalculatedAnswers(
          view.document.templateSnapshot,
          view.answers,
          pruneHiddenAnswerPatch(view.document.templateSnapshot, view.answers, changedAnswerPatch)
        )
        // An answer someone else has signed is kept as signed by
        // complete_document_recipient_signature, under its row lock.
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
          effectiveValues,
          view.signers.findIndex((signer: PublicSignerStatus): boolean => signer.id === recipient.id) + 1
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
          expectedValues: calculationBase(view.document.templateSnapshot, view.answers),
          consented: true,
          ip: input.ip ?? null,
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
      })
    }
  )
}

/**
 * Lets a signer turn the document down with a reason: the document goes back to
 * its sender as a draft, every link stops working, and the sender and the
 * other signers are told. An email that fails never undoes the decline.
 *
 * @param input - Private token and the signer's reason.
 * @param deps - Optional clock, database, email and audit dependencies for tests.
 * @returns The document's title and organization, for the page that confirms it.
 * @throws DocumentSigningServiceError for a missing reason, a bad link, or a signer who signed.
 */
export async function declinePublicDocumentSigning(
  input: DeclinePublicDocumentSigningInput,
  deps: DocumentSigningServiceDeps = {}
): Promise<{ documentTitle: string; organizationName: string }> {
  return runSigningOperation("decline_public_document_signing", {}, async () => {
    const reason = input.reason.trim()

    if (reason.length < 1 || reason.length > 500) {
      throw new DocumentSigningServiceError("Say why you are not signing, in up to 500 characters.", 400)
    }

    const client = resolveSigningClient(deps.client)
    const recipient = await loadRecipientByToken(client, hashToken(normalizeToken(input.token)))
    assertRecipientLinkUsable(recipient, getSigningNow(deps.now))
    await requirePublicSigningDocumentLifecycle(client, recipient, "mutation")

    if (recipient.status === "signed") {
      throw new DocumentSigningServiceError("You have already signed this document.", 409)
    }

    const view = await loadPublicSigningView(client, recipient)
    const revoked = await declineSigningWorkflow(client, recipient, reason)
    const declinedAt = getSigningNow(deps.now).toISOString()
    const documentId = recipient.document_id
    const organizationId = recipient.org_id

    await recordAuditLogBestEffort(
      {
        organizationId,
        actorUserId: null,
        action: "document.signing_declined",
        targetType: "document",
        targetId: documentId,
        metadata: { recipientId: recipient.id, revokedLinks: revoked.length },
      },
      deps.recordAuditLog
    )

    const senderEmail = await loadProfileEmail(client, recipient.sent_by ?? view.document.createdBy)
    const sendDeclined = deps.sendDocumentSigningDeclinedEmail ?? defaultSendDocumentSigningDeclinedEmail
    const sendCancelled = deps.sendDocumentSigningCancelledEmail ?? defaultSendDocumentSigningCancelledEmail
    const deliveries = await Promise.allSettled([
      ...(senderEmail
        ? [sendDeclined({ declinedAt, declinerName: recipient.name, documentId, documentTitle: view.document.title, reason, recipientEmail: senderEmail })]
        : []),
      ...revoked
        .filter((other) => other.id !== recipient.id)
        .map((other) =>
          sendCancelled({
            documentId,
            documentTitle: view.document.title,
            organizationName: view.organizationName,
            recipientEmail: other.email,
            recipientId: other.id,
            recipientName: other.name,
            revokedAt: declinedAt,
            signed: other.status === "signed",
          })
        ),
    ])
    const failedDeliveries = deliveries.filter((delivery) => delivery.status === "rejected").length

    if (failedDeliveries > 0 || !senderEmail) {
      console.warn("document_signing_declined_email_incomplete", { organizationId, documentId, failedDeliveries, senderFound: Boolean(senderEmail) })
    }

    return { documentTitle: view.document.title, organizationName: view.organizationName }
  })
}

/**
 * Runs a save that works answers out from the answers it read, from a fresh
 * read each time the database finds someone else changed them first, after
 * a pause that spreads colliding writers out; the last conflict reaches the
 * caller.
 *
 * @param attempt - The whole read, work-out and save.
 * @returns What the save that went through returns.
 */
async function retryOnChangedAnswers<T>(attempt: () => Promise<T>): Promise<T> {
  for (let tries = 1; ; tries += 1) {
    try {
      return await attempt()
    } catch (error) {
      if (tries === MAX_ATTEMPTS || !(error instanceof DocumentSigningServiceError) || error.message !== CHANGED_ANSWERS_MESSAGE) {
        throw error
      }

      await waitBeforeRetry(tries)
    }
  }
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
  return asSigningError(
    requireDocumentAccess(
      {
        organizationId,
        documentId,
        actorUserId,
        requiredAccess,
        operation,
        requiredOrganizationPermissionAction: organizationAction,
      },
      client
    ),
    rejectionMessage
  )
}

function asSigningError<T>(access: Promise<T>, rejectionMessage: string): Promise<T> {
  return requireDocumentAccessAs(
    access,
    (message, statusCode) => new DocumentSigningServiceError(message, statusCode),
    rejectionMessage
  )
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
  requireReadableDocument(
    await client
      .from("documents")
      .select("lifecycle_state")
      .eq("id", documentId)
      .eq("org_id", organizationId)
      .maybeSingle(),
    {
      loadFailed: (error) => createDatabaseError(error, "Unable to load generated document."),
      notFound: () => new DocumentSigningServiceError(messages.unavailable, 404),
      unsupported: () =>
        new DocumentSigningServiceError("Database returned an unsupported document lifecycle state.", 500),
      ...(operation === "mutation"
        ? { archived: () => new DocumentSigningServiceError(messages.inactive, 409) }
        : {}),
    }
  )
}
