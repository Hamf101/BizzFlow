import { cache } from "react"

import type { TemplateAccessLevel } from "@/lib/supabase/admin"
import { loadActiveMembership } from "@/services/organizations/active-membership"

import type { TemplateServiceClient } from "./contracts"
import { TemplateServiceError } from "./errors"
import { createDatabaseError, requirePermission } from "./shared"

const RANK: Record<TemplateAccessLevel, number> = { editor: 3, user: 2, viewer: 1 }

/** A member, a workspace and the template in question. */
export type TemplateAccessInput = {
  actorUserId: string
  organizationId: string
  templateId: string
}

/**
 * What a member may do with one template, decided in the database so the
 * service, the list and the live editing rooms cannot disagree: nothing, view
 * it, use it to make documents, or edit it.
 *
 * @param client - Service client.
 * @param input - Member, workspace and template.
 * @returns The level, or null when they cannot open it.
 * @throws TemplateServiceError when the lookup fails.
 */
export async function getTemplateAccess(
  client: TemplateServiceClient,
  input: TemplateAccessInput
): Promise<TemplateAccessLevel | null> {
  const { data, error } = await client.rpc("get_template_access_level", {
    target_actor_user_id: input.actorUserId,
    target_org_id: input.organizationId,
    target_template_id: input.templateId,
  })

  if (error) {
    throw createDatabaseError(error, "Unable to load template access.")
  }

  return data ?? null
}

/**
 * Requires a level of access to one template.
 *
 * @param client - Service client.
 * @param input - Member, workspace and template.
 * @param level - The least level the operation needs.
 * @param rejection - What to tell someone who can open it but not do this.
 * @returns The level they have.
 * @throws TemplateServiceError 404 when they cannot open it, 403 when their level is too low.
 */
export async function requireTemplateAccess(
  client: TemplateServiceClient,
  input: TemplateAccessInput,
  level: TemplateAccessLevel,
  rejection: string
): Promise<TemplateAccessLevel> {
  const held = await getTemplateAccess(client, input)

  if (!held) {
    // Someone outside the workspace is refused; a member is told it does not exist.
    const { data } = await loadActiveMembership(client, input.organizationId, input.actorUserId)

    throw data ? new TemplateServiceError("Document template was not found.", 404) : new TemplateServiceError(rejection, 403)
  }

  if (RANK[held] < RANK[level]) {
    throw new TemplateServiceError(rejection, 403)
  }

  return held
}

/**
 * Requires the right to make a template of one's own. Managing templates
 * includes it.
 *
 * @param client - Service client.
 * @param organizationId - The workspace.
 * @param actorUserId - The member.
 * @throws TemplateServiceError 403 without either permission.
 */
export async function requireCanCreateTemplates(
  client: TemplateServiceClient,
  organizationId: string,
  actorUserId: string
): Promise<void> {
  const refusal = "You cannot create templates."

  await requirePermission(client, organizationId, actorUserId, "templates:create", refusal).catch((error: unknown) => {
    if (error instanceof TemplateServiceError && error.statusCode === 403) {
      return requirePermission(client, organizationId, actorUserId, "templates:manage", refusal)
    }

    throw error
  })
}

/**
 * Which templates a list must leave out and add for a member: restricted ones
 * they cannot open, and any status of the ones they may edit. A page's list and
 * its category filter both ask, so within one render they share one answer.
 *
 * @param client - Service client.
 * @param organizationId - The workspace.
 * @param actorUserId - The member.
 * @returns Ids to hide, and ids they may edit.
 * @throws TemplateServiceError when a lookup fails.
 */
export const templateVisibility = cache(async function templateVisibility(
  client: TemplateServiceClient,
  organizationId: string,
  actorUserId: string
): Promise<{ editable: string[]; hidden: string[] }> {
  const args = { target_actor_user_id: actorUserId, target_org_id: organizationId }
  const [hidden, editable] = await Promise.all([
    client.rpc("hidden_template_ids", args),
    client.rpc("editable_template_ids", args),
  ])

  if (hidden.error || editable.error) {
    throw createDatabaseError(hidden.error ?? editable.error, "Unable to load which templates are shared.")
  }

  return { editable: editable.data ?? [], hidden: hidden.data ?? [] }
})

type VisibilityQuery = {
  eq(column: string, value: string): VisibilityQuery
  not(column: string, operator: string, value: string): VisibilityQuery
  or(filters: string): VisibilityQuery
}

/**
 * Narrows a templates query to what a member may see: no restricted template
 * they cannot open, and no draft unless they may edit it. Someone who manages
 * templates edits every open draft, so only restricted ones need leaving out.
 *
 * @param query - A query on document_templates.
 * @param visibility - What templateVisibility answered for the member.
 * @param managesTemplates - Whether the member holds templates:manage.
 * @returns The same query, narrowed.
 */
export function onlyVisibleTemplates<TQuery>(
  query: TQuery,
  visibility: { editable: readonly string[]; hidden: readonly string[] },
  managesTemplates: boolean
): TQuery {
  let narrowed = query as unknown as VisibilityQuery

  // ponytail: restricted templates a member cannot open go in the address; thousands of them would need a database-side filter.
  if (visibility.hidden.length > 0) {
    narrowed = narrowed.not("id", "in", `(${visibility.hidden.join(",")})`)
  }

  if (!managesTemplates) {
    narrowed =
      visibility.editable.length > 0
        ? narrowed.or(`status.eq.published,id.in.(${visibility.editable.join(",")})`)
        : narrowed.eq("status", "published")
  }

  return narrowed as unknown as TQuery
}
