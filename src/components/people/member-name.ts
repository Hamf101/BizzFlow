import { ORGANIZATION_ROLE_LABELS } from "@/lib/permissions"
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

/**
 * Names a member's role: their role definition's name, or the built-in role's.
 *
 * @param member - The member.
 * @returns The role's name.
 */
export function getMemberRoleName(member: Pick<OrganizationMember, "role" | "roleName">): string {
  return member.roleName ?? ORGANIZATION_ROLE_LABELS[member.role]
}

/**
 * Names a member the way the People page does: the name they go by, or one
 * read from their email address.
 *
 * @param member - The member.
 * @returns The member's name.
 */
export function getMemberDisplayName(
  member: Pick<OrganizationMember, "email" | "fullName" | "workspaceDisplayName">
): string {
  const explicitName =
    member.workspaceDisplayName?.trim() || member.fullName?.trim()
  if (explicitName) {
    return explicitName
  }

  const emailName = member.email
    .split("@", 1)[0]
    .split("+", 1)[0]
    .replace(/[._-]+/g, " ")
    .trim()

  return emailName
    ? emailName.replace(/\b[a-z]/g, (character) => character.toLocaleUpperCase())
    : "Member"
}
