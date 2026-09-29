import { DocumentServiceError } from "@/services/documents/errors"
import { broadcastSharingNotice } from "@/services/documents/sharing-notice"
import type {
  SetSharingAccessInput,
  SetSharingInheritanceInput,
  SharingGrant,
  SharingManyInput,
  SharingNotice,
  SharingServiceDeps,
  SharingView,
} from "@/services/documents/sharing-contracts"
import {
  getSharing,
  listSharingMembers,
  setSharingAccess,
  setSharingInheritance,
} from "@/services/documents/sharing-service"

/** The most items one Share covers; more would make a slow, hard-to-read dialog. */
export const MAX_SHARED_ITEMS = 50

type Many<T> = Omit<T, "resource"> & Pick<SharingManyInput, "resources">

/**
 * Shows what several items have in common: who can open all of them, and, when
 * they sit in one folder, what that folder gives them. One item shows its own
 * sharing in full.
 *
 * @param input - Actor, organization and the items.
 * @param deps - Injected client and people lookup for tests.
 * @returns The shared part of their sharing.
 * @throws DocumentServiceError when any of them may not be shared by this person.
 */
export async function getSharingMany(input: SharingManyInput, deps: SharingServiceDeps = {}): Promise<SharingView> {
  const views = await viewsOf(input, once(deps))

  return views.length === 1 ? (views[0] as SharingView) : combine(views)
}

/**
 * Shares every item with a person or a role, changes the level, or takes the
 * access away. Every item is checked before any is changed, and a person
 * newly added is told once, not once per item.
 *
 * @param input - Actor, organization, items, who, and what level.
 * @param deps - Injected client, ids, people lookup, notice and audit for tests.
 * @returns What the items now have in common.
 * @throws DocumentServiceError when any of them may not be shared by this person.
 */
export async function setSharingAccessMany(
  input: Many<SetSharingAccessInput>,
  deps: SharingServiceDeps = {}
): Promise<SharingView> {
  const shared = once(deps)
  const { level, principal, ...rest } = input
  await viewsOf(rest, shared)
  const told: SharingNotice[] = []

  for (const resource of input.resources) {
    await setSharingAccess(
      { actorUserId: input.actorUserId, level, organizationId: input.organizationId, principal, resource },
      input.resources.length === 1 ? shared : { ...shared, notify: async (notice) => void told.push(notice) }
    )
  }

  if (input.resources.length > 1) {
    await tellOnce(told, deps)
  }

  return getSharingMany(rest, shared)
}

/**
 * Chooses whether every item also takes in what the folders above it are shared with.
 *
 * @param input - Actor, organization, items and the choice.
 * @param deps - Injected client, people lookup and audit for tests.
 * @returns What the items now have in common.
 * @throws DocumentServiceError when any of them may not be shared by this person.
 */
export async function setSharingInheritanceMany(
  input: Many<SetSharingInheritanceInput>,
  deps: SharingServiceDeps = {}
): Promise<SharingView> {
  const shared = once(deps)
  const { inherit, ...rest } = input
  await viewsOf(rest, shared)

  for (const resource of input.resources) {
    await setSharingInheritance({ actorUserId: input.actorUserId, inherit, organizationId: input.organizationId, resource }, shared)
  }

  return getSharingMany(rest, shared)
}

// Everyone in the workspace is read once, not once per item.
function once(deps: SharingServiceDeps): SharingServiceDeps {
  let people: ReturnType<NonNullable<SharingServiceDeps["listMembers"]>> | null = null
  const list = deps.listMembers ?? listSharingMembers

  return { ...deps, listMembers: (organizationId, actorUserId) => (people ??= list(organizationId, actorUserId)) }
}

async function viewsOf(input: SharingManyInput, deps: SharingServiceDeps): Promise<SharingView[]> {
  const unique = new Set(input.resources.map((resource) => `${resource.kind}:${resource.id}`))

  if (unique.size === 0 || unique.size !== input.resources.length || unique.size > MAX_SHARED_ITEMS) {
    throw new DocumentServiceError(`Choose between 1 and ${MAX_SHARED_ITEMS} different items.`, 400)
  }

  const views: SharingView[] = []

  for (const resource of input.resources) {
    views.push(await getSharing({ actorUserId: input.actorUserId, organizationId: input.organizationId, resource }, deps))
  }

  return views
}

const sameWho = (a: SharingGrant, b: SharingGrant): boolean =>
  a.kind === "person" && b.kind === "person" ? a.person.userId === b.person.userId : a.kind === "role" && b.kind === "role" && a.role === b.role

function combine(views: SharingView[]): SharingView {
  const [first, ...others] = views as [SharingView, ...SharingView[]]
  const grants = first.grants.flatMap((grant): SharingGrant[] => {
    const matches = others.map((view) => view.grants.find((candidate) => sameWho(candidate, grant)))

    if (matches.some((match) => !match)) {
      return []
    }

    const levels = new Set([grant.level, ...matches.map((match) => match?.level)])

    // Where the levels differ the lowest is shown, so choosing a level is always a deliberate change.
    return [levels.size > 1 ? { ...grant, level: "viewer", mixed: true } : grant]
  })
  const sameFolder = others.every(
    (view) => view.parent?.id === first.parent?.id && view.inherit === first.inherit
  )

  return {
    grants,
    inherit: first.inherit,
    inherited: sameFolder ? first.inherited : [],
    members: first.members,
    name: `${views.length} items`,
    owner: null,
    parent: sameFolder ? first.parent : null,
  }
}

async function tellOnce(notices: SharingNotice[], deps: SharingServiceDeps): Promise<void> {
  const send = deps.notify ?? broadcastSharingNotice
  const byPerson = new Map<string, SharingNotice[]>()

  for (const notice of notices) {
    byPerson.set(notice.recipientUserId, [...(byPerson.get(notice.recipientUserId) ?? []), notice])
  }

  for (const [, group] of byPerson) {
    const first = group[0] as SharingNotice

    // A failed notice never undoes a share.
    await send(group.length === 1 ? first : { ...first, count: group.length }).catch((error: unknown) => {
      console.warn("sharing_notice_failed", { reason: error instanceof Error ? error.message : "Unknown error" })
    })
  }
}
