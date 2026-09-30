"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildRedirect } from "@/lib/form-utils"
import {
  DocumentServiceError,
  getSharingMany,
  setSharingAccessMany,
  setSharingInheritanceMany,
  type SharingView,
} from "@/services/document-service"
import { getCurrentOrganizationContext } from "@/services/organization-service"

const resourceSchema = z.object({ id: z.string().uuid(), kind: z.enum(["document", "folder", "template"]) })
// One item or a selection; the service holds the same limit.
const resourcesSchema = z.array(resourceSchema).min(1).max(50)
const principalSchema = z.union([
  z.object({ userId: z.string().uuid() }).strict(),
  z.object({ role: z.enum(["manager", "staff", "external_reviewer"]) }).strict(),
])
const accessSchema = z.object({
  level: z.enum(["viewer", "contributor", "user", "editor"]).nullable(),
  principal: principalSchema,
  resources: resourcesSchema,
})
const inheritanceSchema = z.object({ inherit: z.boolean(), resources: resourcesSchema })

/** What the Share dialog gets back: the sharing as it now stands, or why not. */
export type SharingResult = { ok: true; view: SharingView } | { message: string; ok: false }

type Who = { actorUserId: string; organizationId: string }

/**
 * Opens the sharing of one item, or what several items have in common, for the Share dialog.
 *
 * @param resources - The documents and folders.
 * @returns Their sharing, or a plain-words reason it cannot be shown.
 */
export async function loadSharingAction(resources: z.infer<typeof resourcesSchema>): Promise<SharingResult> {
  return run(resourcesSchema.safeParse(resources), false, (who, parsed) => getSharingMany({ ...who, resources: parsed }))
}

/**
 * Shares an item with a person or a role, changes the level, or takes it away.
 *
 * @param input - The items, who, and the level (null removes it).
 * @returns The sharing afterwards, or a plain-words reason it was refused.
 */
export async function setSharingAccessAction(input: z.infer<typeof accessSchema>): Promise<SharingResult> {
  return run(accessSchema.safeParse(input), true, (who, parsed) => setSharingAccessMany({ ...who, ...parsed }))
}

/**
 * Chooses whether an item also takes in what the folders above it are shared with.
 *
 * @param input - The items and the choice.
 * @returns The sharing afterwards, or a plain-words reason it was refused.
 */
export async function setSharingInheritanceAction(input: z.infer<typeof inheritanceSchema>): Promise<SharingResult> {
  return run(inheritanceSchema.safeParse(input), true, (who, parsed) => setSharingInheritanceMany({ ...who, ...parsed }))
}

async function run<T>(
  parsed: z.ZodSafeParseResult<T>,
  changes: boolean,
  operation: (who: Who, input: T) => Promise<SharingView>
): Promise<SharingResult> {
  if (!parsed.success) {
    return { message: "That could not be understood. Try again.", ok: false }
  }

  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      return { message: "Create or join a workspace first.", ok: false }
    }

    const view = await operation({ actorUserId: user.id, organizationId: context.organization.id }, parsed.data)

    if (changes) {
      revalidatePath("/documents")
      revalidatePath("/templates")
    }

    return { ok: true, view }
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/documents" }))
    }

    if (error instanceof DocumentServiceError) {
      return { message: error.message, ok: false }
    }

    console.error("sharing_action_failed", { reason: error instanceof Error ? error.message : "Unknown error" })

    return { message: "Sharing could not be changed. Try again.", ok: false }
  }
}
