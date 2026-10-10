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

  return (member && memberLabel(member)) || "a former member"
}

/**
 * Names a member by their full name, or their email without one. The name they
 * go by in the workspace is the People page's; these labels never used it.
 *
 * @param member - The member.
 * @returns The name or email.
 */
export function memberLabel(member: Pick<OrganizationMember, "email" | "fullName">): string {
  return member.fullName?.trim() || member.email
}

/**
 * Two letters for an avatar: the first letters of a name's first and last
 * words, or the email's first letter when the name is blank.
 *
 * @param name - The name shown beside the avatar.
 * @param email - Fallback when the name has no letters.
 * @returns One or two uppercase letters, or "?" with neither.
 */
export function getInitials(name: string | null | undefined, email = ""): string {
  const words = (name ?? "").split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const letter = (word: string | undefined): string => (word ? [...word][0] : "")
  const initials =
    words.length > 1
      ? letter(words[0]) + letter(words.at(-1))
      : letter(words[0] ?? email.match(/[\p{L}\p{N}]/u)?.[0])

  return initials.toUpperCase() || "?"
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
