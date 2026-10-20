"use server"

import { buildSharedDocumentPath } from "@/lib/auth-redirects"
import {
  acceptInviteLink,
  type InviteLink,
  joinInviteLinkWithPassword,
  switchInviteLinkAccount,
} from "@/lib/invite-link"
import {
  acceptDocumentGuestInvite,
  createGuestAccount,
  DocumentServiceError,
  getGuestInvite,
} from "@/services/document-service"

/**
 * Opens the shared document as the account already signed in.
 *
 * @param formData - The link's token.
 * @returns Never returns; redirects to the document or back with the reason.
 */
export async function acceptSharedDocumentAction(formData: FormData): Promise<void> {
  await acceptInviteLink(formData, sharedDocument)
}

/**
 * Opens the shared document in one step from a signed-out browser: opens an
 * account for someone new, or signs in someone who already has one, then accepts.
 *
 * @param formData - The link's token, whether they have an account, a password (twice when new), and someone new's name and optional phone.
 * @returns Never returns; redirects to the document or back with the reason.
 */
export async function openSharedDocumentWithPasswordAction(formData: FormData): Promise<void> {
  await joinInviteLinkWithPassword(formData, sharedDocument)
}

/**
 * Signs out an account the link isn't for, so its owner can open it.
 *
 * @param formData - The link's token.
 * @returns Never returns; reopens the link.
 */
export async function switchSharedDocumentAccountAction(formData: FormData): Promise<void> {
  await switchInviteLinkAccount(formData, sharedDocument)
}

function sharedDocument(token: string): InviteLink {
  return {
    path: buildSharedDocumentPath(token),
    event: "shared_document",
    openAccount: (password) => createGuestAccount({ password, token }),
    findEmail: async () => (await getGuestInvite(token)).email,
    accept: async (user) => {
      const { documentId } = await acceptDocumentGuestInvite({ token, userEmail: user.email, userId: user.id })
      return `/documents/${encodeURIComponent(documentId)}/edit`
    },
    explain: (error) =>
      error instanceof DocumentServiceError
        ? error.statusCode === 404 || error.statusCode === 410
          ? "This link has expired or was already used. Ask for a new one."
          : error.message
        : undefined,
    fallback: "Unable to open the document. Try again.",
  }
}
