import { createAdminClient } from "@/lib/supabase/admin"
import type { OrganizationMutationDeps } from "@/services/organizations/contracts"
import { OrganizationServiceError } from "@/services/organizations/errors"
import {
  createSupabaseServiceError,
  runOrganizationOperation,
} from "@/services/organizations/shared"
import { type EditorLayout, editorLayoutSchema } from "@/types/editor-layout"

type Actor = { actorUserId: string }

/**
 * Reads where a person keeps the editor's tools. Nothing saved, or a layout
 * that no longer reads as one, gives the editor's own arrangement.
 *
 * @param input - The signed-in person.
 * @param deps - Injectable database dependency.
 * @returns The saved layout, or an empty one.
 * @throws OrganizationServiceError when the profile cannot be read.
 */
export async function getEditorLayout(
  input: Actor,
  deps: OrganizationMutationDeps = {},
): Promise<EditorLayout> {
  return runOrganizationOperation("get_editor_layout", input, async () => {
    const client = deps.client ?? createAdminClient()
    const { data, error } = await client.from("profiles")
      .select("editor_layout")
      .eq("id", input.actorUserId)
      .maybeSingle()
    if (error) throw createSupabaseServiceError(error, "Unable to load where the editor's tools are.")
    const saved = editorLayoutSchema.safeParse(data?.editor_layout ?? {})
    return saved.success ? saved.data : {}
  })
}

/**
 * Keeps where a person put the editor's tools on their own profile, so the
 * tools are there again on any device they sign in on.
 *
 * @param input - The signed-in person and the layout to keep.
 * @param deps - Injectable database dependency.
 * @returns Resolves once the layout is saved.
 * @throws OrganizationServiceError for a layout outside the editor, or a failed write.
 */
export async function saveEditorLayout(
  input: Actor & { layout: unknown },
  deps: OrganizationMutationDeps = {},
): Promise<void> {
  return runOrganizationOperation("save_editor_layout", { actorUserId: input.actorUserId }, async () => {
    const layout = editorLayoutSchema.safeParse(input.layout)
    if (!layout.success) {
      throw new OrganizationServiceError("Place the tools inside the editor.", 400)
    }
    const client = deps.client ?? createAdminClient()
    const { data, error } = await client.from("profiles")
      .update({ editor_layout: layout.data })
      .eq("id", input.actorUserId)
      .select("id")
      .maybeSingle()
    if (error) throw createSupabaseServiceError(error, "Unable to keep where the editor's tools are.")
    if (!data) throw new OrganizationServiceError("Your profile could not be found.", 404)
  })
}
