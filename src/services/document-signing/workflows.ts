import { randomUUID } from "node:crypto"

import {
  sendDocumentSigningEmail as defaultSendDocumentSigningEmail,
  DocumentSigningEmailServiceError,
} from "@/services/document-signing-email-service"
import {
  assertRequiredAnswersComplete,
  collectFields,
  deriveChangedAnswerPatch,
  normalizeAnswerPatch,
} from "@/services/document-signing/answer-validation"
import type {
  CompletePublicDocumentSigningInput,
  DocumentSigningServiceDeps,
  GetGeneratedDocumentSigningViewInput,
  GetPublicDocumentSigningViewInput,
  ResendDocumentSigningInvitationInput,
  SaveGeneratedDocumentAnswersInput,
  SendDocumentForSigningInput,
} from "@/services/document-signing/contracts"
import {
  normalizeOptionalDrawing,
  normalizeRequiredDrawing,
} from "@/services/document-signing/drawing-validation"
import {
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
  requirePermission,
  resolveSigningClient,
  startSigningWorkflow,
} from "@/services/document-signing/persistence"
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
import type { DocumentSigningRecipientRow } from "@/types/template"

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

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "documents:view",
        "You cannot view this document."
      )
      return loadGeneratedDocumentView(
        client,
        input.organizationId,
        input.documentId
      )
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

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "documents:fill",
        "You cannot fill this document."
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

      const normalizedPatch = await normalizeAnswerPatch(
        collectFields(view.document.templateSnapshot),
        input.values
      )
      const persistedValues = await mergeGeneratedDocumentAnswers(
        client,
        input.organizationId,
        input.documentId,
        normalizedPatch
      )

      for (const [fieldKey, value] of Object.entries(normalizedPatch)) {
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
 * Creates unordered signing recipients and emails each a private expiring link.
 *
 * @param input - Actor, generated document, and recipient collection.
 * @param deps - Optional id, token, clock, database, and email dependencies.
 * @returns Created recipients after Resend accepts every invitation.
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

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "documents:send",
        "You cannot send documents for signing."
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

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "documents:send",
        "You cannot send documents for signing."
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
      const answerPatch = deriveChangedAnswerPatch(
        submittedValues,
        baselineValues
      )
      assertRequiredAnswersComplete(
        fieldByKey,
        { ...view.answers, ...answerPatch },
        isLastRequiredRecipient
      )
      const [signatureData, initialsData] = await Promise.all([
        recipient.requires_signature
          ? normalizeRequiredDrawing(input.signatureDataUrl, "signature")
          : normalizeOptionalDrawing(input.signatureDataUrl, "signature"),
        view.requiresInitials
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
