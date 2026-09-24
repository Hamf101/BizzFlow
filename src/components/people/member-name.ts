import type { OrganizationMember } from "@/types/organization"

/**
 * Names a member for a list cell or label.
 *
 * @param userId - The member's user id, or null when nobody is set.
 * @param members - Members whose names are known to this view.
 * @param currentUserId - The viewer, who is called "You".
 * @returns "Unassigned", "You", the member's name or email, or "a former member".
 */
export function formatMemberName(
  userId: string | null,
  members: readonly OrganizationMember[],
  currentUserId?: string
): string {
  if (!userId) {
    return "Unassigned"
  }

  if (userId === currentUserId) {
    return "You"
  }

  const member = members.find(
    (candidate: OrganizationMember): boolean => candidate.userId === userId
  )

  return member?.fullName?.trim() || member?.email || "a former member"
}
