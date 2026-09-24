import { createAdminClient } from "@/lib/supabase/admin"
import type {
  OrganizationMutationDeps,
  OrganizationServiceClient,
} from "@/services/organizations/contracts"
import { OrganizationServiceError } from "@/services/organizations/errors"
import {
  createSupabaseServiceError,
  runOrganizationOperation,
} from "@/services/organizations/shared"
import {
  MAX_SAVED_VIEWS_PER_LIST,
  savedViewIdSchema,
  savedViewListSchema,
  savedViewNameSchema,
  savedViewQuerySchema,
  type SavedView,
  type SavedViewList,
} from "@/types/saved-view"

type Actor = { actorUserId: string; organizationId: string }

const SAVED_VIEW_COLUMNS = "id,list,name,query"
const UNIQUE_VIOLATION = "23505"
const DUPLICATE_NAME = "You already have a view with that name on this list."
const MISSING_VIEW = "That saved view no longer exists."

// A view belongs to a member, so every call starts from an active membership.
async function requireActiveMember(
  client: OrganizationServiceClient,
  input: Actor,
): Promise<void> {
  const { data, error } = await client.from("organization_memberships")
    .select("id")
    .eq("org_id", input.organizationId)
    .eq("user_id", input.actorUserId)
    .eq("status", "active")
    .maybeSingle()
  if (error) throw createSupabaseServiceError(error, "Unable to load saved views.")
  if (!data) {
    throw new OrganizationServiceError("You do not have access to this workspace.", 403)
  }
}

function parseList(list: string): SavedViewList {
  const parsed = savedViewListSchema.safeParse(list)
  if (!parsed.success) {
    throw new OrganizationServiceError("Choose a list that keeps saved views.", 400)
  }
  return parsed.data
}

function parseName(name: string): string {
  const parsed = savedViewNameSchema.safeParse(name)
  if (!parsed.success) {
    throw new OrganizationServiceError("Name the view in 1 to 40 characters.", 400)
  }
  return parsed.data
}

// A malformed id cannot name any view, so it reads as one that is gone.
function parseViewId(viewId: string): string {
  const parsed = savedViewIdSchema.safeParse(viewId)
  if (!parsed.success) throw new OrganizationServiceError(MISSING_VIEW, 404)
  return parsed.data
}

function mapSavedView(row: SavedView): SavedView {
  return { id: row.id, list: row.list, name: row.name, query: row.query }
}

/**
 * Lists the actor's own views of one list in this workspace, by name.
 * @param input - Actor, workspace, and the list whose views to read.
 * @param deps - Injectable database dependencies.
 * @returns The actor's saved views of the list.
 * @throws OrganizationServiceError for nonmembers, unknown lists, or database failures.
 */
export async function listSavedViews(
  input: Actor & { list: string },
  deps: OrganizationMutationDeps = {},
): Promise<SavedView[]> {
  return runOrganizationOperation("list_saved_views", {
    actorUserId: input.actorUserId,
    list: input.list,
    organizationId: input.organizationId,
  }, async () => {
    const client = deps.client ?? createAdminClient()
    await requireActiveMember(client, input)
    const list = parseList(input.list)
    const { data, error } = await client.from("saved_list_views")
      .select(SAVED_VIEW_COLUMNS)
      .eq("org_id", input.organizationId)
      .eq("user_id", input.actorUserId)
      .eq("list", list)
      .order("name", { ascending: true })
    if (error) throw createSupabaseServiceError(error, "Unable to load saved views.")
    return (data ?? []).map((row) => mapSavedView(row as SavedView))
  })
}

/**
 * Saves the actor's current settings of a list under a name of their own.
 * @param input - Actor, workspace, list, the view's name, and its canonical query.
 * @param deps - Injectable database dependencies.
 * @returns The saved view.
 * @throws OrganizationServiceError for nonmembers, invalid input, a taken name,
 *   a full list, or database failures.
 */
export async function saveListView(
  input: Actor & { list: string; name: string; query: string },
  deps: OrganizationMutationDeps = {},
): Promise<SavedView> {
  return runOrganizationOperation("save_list_view", {
    actorUserId: input.actorUserId,
    list: input.list,
    organizationId: input.organizationId,
  }, async () => {
    const client = deps.client ?? createAdminClient()
    await requireActiveMember(client, input)
    const list = parseList(input.list)
    const name = parseName(input.name)
    const query = savedViewQuerySchema.safeParse(input.query)
    if (!query.success) {
      throw new OrganizationServiceError("That view cannot be saved.", 400)
    }
    const { count, error: countError } = await client.from("saved_list_views")
      .select("id", { count: "exact", head: true })
      .eq("org_id", input.organizationId)
      .eq("user_id", input.actorUserId)
      .eq("list", list)
    if (countError) throw createSupabaseServiceError(countError, "Unable to save the view.")
    if ((count ?? 0) >= MAX_SAVED_VIEWS_PER_LIST) {
      throw new OrganizationServiceError(
        `Keep up to ${MAX_SAVED_VIEWS_PER_LIST} saved views on a list; delete one first.`,
        409,
      )
    }
    const { data, error } = await client.from("saved_list_views")
      .insert({
        list,
        name,
        org_id: input.organizationId,
        query: query.data,
        user_id: input.actorUserId,
      })
      .select(SAVED_VIEW_COLUMNS)
      .single()
    if (error?.code === UNIQUE_VIOLATION) throw new OrganizationServiceError(DUPLICATE_NAME, 409)
    if (error || !data) throw createSupabaseServiceError(error, "Unable to save the view.")
    return mapSavedView(data as SavedView)
  })
}

/**
 * Renames one of the actor's own views.
 * @param input - Actor, workspace, the view, and its new name.
 * @param deps - Injectable database dependencies.
 * @returns The renamed view.
 * @throws OrganizationServiceError for nonmembers, invalid names, a taken name,
 *   another member's or a missing view, or database failures.
 */
export async function renameSavedView(
  input: Actor & { viewId: string; name: string },
  deps: OrganizationMutationDeps = {},
): Promise<SavedView> {
  return runOrganizationOperation("rename_saved_view", {
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    viewId: input.viewId,
  }, async () => {
    const client = deps.client ?? createAdminClient()
    await requireActiveMember(client, input)
    const name = parseName(input.name)
    const viewId = parseViewId(input.viewId)
    const { data, error } = await client.from("saved_list_views")
      .update({ name })
      .eq("id", viewId)
      .eq("org_id", input.organizationId)
      .eq("user_id", input.actorUserId)
      .select(SAVED_VIEW_COLUMNS)
      .maybeSingle()
    if (error?.code === UNIQUE_VIOLATION) throw new OrganizationServiceError(DUPLICATE_NAME, 409)
    if (error) throw createSupabaseServiceError(error, "Unable to rename the view.")
    if (!data) throw new OrganizationServiceError(MISSING_VIEW, 404)
    return mapSavedView(data as SavedView)
  })
}

/**
 * Deletes one of the actor's own views.
 * @param input - Actor, workspace, and the view.
 * @param deps - Injectable database dependencies.
 * @returns Resolves once the view is gone.
 * @throws OrganizationServiceError for nonmembers, another member's or a missing
 *   view, or database failures.
 */
export async function deleteSavedView(
  input: Actor & { viewId: string },
  deps: OrganizationMutationDeps = {},
): Promise<void> {
  return runOrganizationOperation("delete_saved_view", {
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    viewId: input.viewId,
  }, async () => {
    const client = deps.client ?? createAdminClient()
    await requireActiveMember(client, input)
    const viewId = parseViewId(input.viewId)
    const { data, error } = await client.from("saved_list_views")
      .delete()
      .eq("id", viewId)
      .eq("org_id", input.organizationId)
      .eq("user_id", input.actorUserId)
      .select("id")
      .maybeSingle()
    if (error) throw createSupabaseServiceError(error, "Unable to delete the view.")
    if (!data) throw new OrganizationServiceError(MISSING_VIEW, 404)
  })
}
