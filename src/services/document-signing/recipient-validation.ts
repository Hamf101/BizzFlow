import { z } from "zod"

import { DocumentSigningServiceError } from "@/services/document-signing/errors"
import type {
  DocumentRecipientInput,
  DocumentSigningRecipient,
} from "@/types/signing"

const MAX_RECIPIENTS = 20

const recipientInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    email: z.string().trim().toLowerCase().email().max(320),
    userId: z.string().trim().min(1).nullable().optional(),
    // Every invitation in this workflow is a signing party. Recipients may
    // submit in any order, but the document completes only after all sign.
    requiresSignature: z.literal(true).optional().default(true),
  })
  .strict()

/** Validated recipient input with an explicit nullable user identifier. */
export type NormalizedRecipientInput = Required<
  Omit<DocumentRecipientInput, "userId">
> & {
  userId: string | null
}

/**
 * Validates, normalizes, and de-duplicates a recipient collection.
 *
 * @param recipients - Untrusted recipient inputs from a member action.
 * @returns Normalized recipient inputs with lowercase emails.
 * @throws DocumentSigningServiceError when the collection is invalid.
 */
export function normalizeRecipientInputs(
  recipients: DocumentRecipientInput[]
): NormalizedRecipientInput[] {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new DocumentSigningServiceError(
      "Add at least one signing recipient.",
      400
    )
  }

  if (recipients.length > MAX_RECIPIENTS) {
    throw new DocumentSigningServiceError(
      `A document can have at most ${MAX_RECIPIENTS} recipients.`,
      400
    )
  }

  const parsed = recipients.map(
    (recipient: DocumentRecipientInput): NormalizedRecipientInput => {
      const result = recipientInputSchema.safeParse(recipient)

      if (!result.success) {
        throw new DocumentSigningServiceError(
          result.error.issues[0]?.message ?? "A signing recipient is invalid.",
          400
        )
      }

      return {
        ...result.data,
        userId: result.data.userId ?? null,
      }
    }
  )
  const emailSet = new Set(parsed.map((recipient): string => recipient.email))

  if (emailSet.size !== parsed.length) {
    throw new DocumentSigningServiceError(
      "Each signing recipient must have a unique email address.",
      400
    )
  }

  return parsed
}

/**
 * Prevents adding an email already attached to a signing document.
 *
 * @param existingRecipients - Existing persisted signing recipients.
 * @param recipients - New normalized recipient inputs.
 * @throws DocumentSigningServiceError when an email is already attached.
 */
export function assertNewRecipientEmails(
  existingRecipients: DocumentSigningRecipient[],
  recipients: Array<{ email: string }>
): void {
  const existingEmails = new Set(
    existingRecipients.map((recipient): string => recipient.email.toLowerCase())
  )
  const duplicate = recipients.find((recipient): boolean =>
    existingEmails.has(recipient.email)
  )

  if (duplicate) {
    throw new DocumentSigningServiceError(
      "A recipient with that email address is already attached to the document.",
      409
    )
  }
}
