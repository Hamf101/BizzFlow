import { canPerformOrganizationAction, type OrganizationRole } from "@/lib/permissions"

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>
type Level = "editor" | "user" | "viewer"

const RANK: Record<Level, number> = { editor: 3, user: 2, viewer: 1 }
const LEVELS: Level[] = ["viewer", "user", "editor"]

/**
 * Stands in for the database's template access functions in service tests,
 * with the same rules as private.effective_template_access_level: owner
 * admins and the maker edit, grants add to that, an unrestricted template also
 * gives what the role does, and external reviewers never go above viewing.
 *
 * @param tables - The fake tables: memberships, templates and template_access_grants.
 * @param name - Which of the three database functions is asked.
 * @param args - Its arguments.
 * @returns What the database would return.
 */
export function answerTemplateAccess(tables: Tables, name: string, args: Record<string, unknown>): { data: unknown; error: null } {
  const organizationId = args.target_org_id
  const actor = args.target_actor_user_id
  const levelOf = (templateId: unknown): Level | null => {
    const membership = tables.organization_memberships?.find(
      (row) => row.org_id === organizationId && row.user_id === actor && row.status === "active"
    )
    const template = tables.document_templates?.find((row) => row.id === templateId && row.org_id === organizationId)

    if (!membership || !template) return null

    const role = membership.role as OrganizationRole

    if (role === "owner_admin") return "editor"

    let rank = template.created_by === actor ? 3 : 0

    for (const grant of tables.template_access_grants ?? []) {
      if (grant.template_id === templateId && (grant.user_id === actor || grant.organization_role === role)) {
        rank = Math.max(rank, RANK[grant.access_level as Level])
      }
    }

    if (!template.access_restricted) {
      if (canPerformOrganizationAction(role, "templates:manage")) rank = Math.max(rank, 3)
      else if (canPerformOrganizationAction(role, "templates:view")) rank = Math.max(rank, 2)
    }

    if (rank === 0) return null

    return role === "external_reviewer" ? "viewer" : (LEVELS[rank - 1] ?? null)
  }

  if (name === "get_template_access_level") return { data: levelOf(args.target_template_id), error: null }

  const templates = (tables.document_templates ?? []).filter((row) => row.org_id === organizationId)

  return {
    data:
      name === "hidden_template_ids"
        ? templates
            .filter((row) => {
              const level = levelOf(row.id)
              return row.access_restricted === true && (level === null || (row.status !== "published" && level !== "editor"))
            })
            .map((row) => row.id)
        : templates.filter((row) => levelOf(row.id) === "editor").map((row) => row.id),
    error: null,
  }
}
