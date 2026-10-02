import { getFallbackDisplayName } from "@/lib/display-name"
import { getMemberSettings } from "@/services/organization-service"

/**
 * The name others working alongside a member see: the one they set, or one
 * made from their email until they do.
 *
 * @param user - The signed-in member.
 * @param organizationId - The organization they are working in.
 * @returns Their display name.
 */
export async function loadMemberName(user: Readonly<{ email: string | null; id: string }>, organizationId: string): Promise<string> {
  return getMemberSettings({ actorUserId: user.id, organizationId })
    .then((settings) => settings.displayName?.trim() || getFallbackDisplayName(user.email))
    .catch(() => getFallbackDisplayName(user.email))
}
