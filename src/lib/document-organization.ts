import { findGuestOrganizationId } from "@/services/document-service"
import { getCurrentOrganizationContext } from "@/services/organization-service"

/**
 * The workspace a request about one document acts in: the document's own for
 * someone outside it who was given it, otherwise the person's current one.
 * Never taken from the request, so nobody can point it elsewhere.
 *
 * @param userId - The signed-in person.
 * @param documentId - The document the request is about.
 * @returns The workspace, or null when they have none and are not its guest.
 */
export async function resolveDocumentOrganizationId(userId: string, documentId: string): Promise<string | null> {
  return (
    (await findGuestOrganizationId({ documentId, userId })) ??
    (await getCurrentOrganizationContext(userId))?.organization.id ??
    null
  )
}
