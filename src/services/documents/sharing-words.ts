import type { OrganizationRole } from "@/lib/permissions"

const GROUPS: Record<OrganizationRole, string> = {
  external_reviewer: "Everyone who is an external reviewer",
  manager: "Everyone who is a manager",
  owner_admin: "Every owner",
  staff: "Everyone who is staff",
}

/**
 * Names everyone who holds a role, the way the Share dialog says it.
 *
 * @param role - The role.
 * @returns For example "Everyone who is a manager".
 */
export function everyoneWho(role: OrganizationRole): string {
  return GROUPS[role]
}
