import type { AdminSupabaseClient } from "@/lib/supabase/admin"

type DocumentCollaborationProfileClient = Pick<AdminSupabaseClient, "from">

/** Minimal profile projection used to label document activity and comments. */
export type DocumentCollaborationProfileRow = {
  id: string
  email: string | null
  full_name: string | null
}

/**
 * Loads the contributor profiles needed by a document collaboration feed.
 *
 * @param client - Trusted Supabase client.
 * @param profileIds - Unique non-null profile identifiers.
 * @param createLoadError - Caller-specific error factory preserving service semantics.
 * @returns Contributor profile rows, or an empty array when no identifiers exist.
 * @throws Error returned by `createLoadError` when the profile query fails.
 */
export async function listDocumentCollaborationProfiles(
  client: DocumentCollaborationProfileClient,
  profileIds: string[],
  createLoadError: () => Error
): Promise<DocumentCollaborationProfileRow[]> {
  if (profileIds.length === 0) {
    return []
  }

  const { data, error } = await client
    .from("profiles")
    .select("id,email,full_name")
    .in("id", profileIds)

  if (error || !data) {
    throw createLoadError()
  }

  return data as DocumentCollaborationProfileRow[]
}

/**
 * Indexes document contributor profiles by user identifier.
 *
 * @param profiles - Profile rows loaded for one document feed.
 * @returns Read-only profile lookup keyed by user identifier.
 */
export function indexDocumentCollaborationProfiles(
  profiles: DocumentCollaborationProfileRow[]
): ReadonlyMap<string, DocumentCollaborationProfileRow> {
  return new Map<string, DocumentCollaborationProfileRow>(
    profiles.map(
      (
        profile: DocumentCollaborationProfileRow
      ): [string, DocumentCollaborationProfileRow] => [profile.id, profile]
    )
  )
}

/**
 * Removes null identifiers and de-duplicates profile lookups.
 *
 * @param values - Nullable actor or author identifiers.
 * @returns Unique non-null identifiers in first-seen order.
 */
export function uniqueDocumentCollaborationProfileIds(
  values: Array<string | null>
): string[] {
  return [
    ...new Set(
      values.filter((value: string | null): value is string => Boolean(value))
    ),
  ]
}

/**
 * Resolves a safe contributor label from a profile lookup.
 *
 * @param userId - Nullable activity actor or comment author identifier.
 * @param profileById - Profiles indexed by user identifier.
 * @param missingUserLabel - Domain label for an event without a user identifier.
 * @returns Full name, email, or the appropriate fallback label.
 */
export function resolveDocumentCollaborationDisplayName(
  userId: string | null,
  profileById: ReadonlyMap<string, DocumentCollaborationProfileRow>,
  missingUserLabel: string
): string {
  if (!userId) {
    return missingUserLabel
  }

  const profile = profileById.get(userId)

  if (!profile) {
    return "Former member"
  }

  const fullName = profile.full_name?.trim()

  if (fullName) {
    return fullName
  }

  return profile.email?.trim() || "Unknown member"
}
