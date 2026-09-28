import { z } from "zod"

import {
  canPerformOrganizationAction,
  ORGANIZATION_ROLE_LABELS,
  type OrganizationPermissionAction,
  type OrganizationPermissionSubject,
} from "@/lib/permissions"
import { listFolderDocuments, listRecentDocuments, listWorkspaceFolders } from "@/services/document-service"
import { getCurrentOrganizationContext, listOrganizationPeople } from "@/services/organization-service"
import { listSubmissionPage } from "@/services/submission-service"
import { listTaskPage } from "@/services/task-service"
import { listTemplatePage } from "@/services/template-service"
import type { AccessibleDocumentFolder, AccessibleDocumentSummary } from "@/types/document"
import type { OrganizationMember } from "@/types/organization"
import type { Submission } from "@/types/submission"
import type { Task } from "@/types/task"
import type { DocumentTemplateSummary } from "@/types/template"

/** The sections one search looks through, in the sidebar's own order. */
export const WORKSPACE_SEARCH_KINDS = ["people", "files", "templates", "submissions", "tasks"] as const

/** One section a search looks through. */
export type WorkspaceSearchKind = (typeof WORKSPACE_SEARCH_KINDS)[number]

// Only what a result and its preview show: never a submission's answers, a
// template's content, or who archived or trashed a file.
const FIELDS = {
  files: ["createdAt", "description", "id", "lifecycleState", "sourceKind", "title", "updatedAt"],
  folders: ["createdAt", "id", "name", "updatedAt"],
  people: ["createdAt", "email", "fullName", "id", "role", "roleName", "workspaceDisplayName"],
  submissions: ["createdAt", "id", "status", "submittedAt", "title", "updatedAt"],
  tasks: ["description", "dueAt", "id", "status", "title", "updatedAt"],
  templates: ["category", "createdAt", "id", "status", "title", "updatedAt"],
} as const

/** One thing a search found, with what its preview shows. */
export type WorkspaceSearchHit =
  | Readonly<{ folder?: undefined; item: Pick<AccessibleDocumentSummary, (typeof FIELDS.files)[number]>; kind: "files" }>
  | Readonly<{ folder: true; item: Pick<AccessibleDocumentFolder, (typeof FIELDS.folders)[number]>; kind: "files" }>
  | Readonly<{ item: Pick<OrganizationMember, (typeof FIELDS.people)[number]>; kind: "people" }>
  | Readonly<{ item: Pick<Submission, (typeof FIELDS.submissions)[number]>; kind: "submissions" }>
  | Readonly<{ item: Pick<Task, (typeof FIELDS.tasks)[number]>; kind: "tasks" }>
  | Readonly<{ item: Pick<DocumentTemplateSummary, (typeof FIELDS.templates)[number]>; kind: "templates" }>

/** What a search found, and how much each section the member may open holds. */
export type WorkspaceSearchResult = Readonly<{
  hits: readonly WorkspaceSearchHit[]
  totals: Readonly<Partial<Record<WorkspaceSearchKind, number>>>
}>

export type WorkspaceSearchInput = {
  actorUserId: string
  /** One section to look through, or every one. */
  kind?: unknown
  organizationId: string
  /** The words; none, with a section, opens that section's own list. */
  query?: unknown
}

type Actor = { actorUserId: string; organizationId: string }

export type WorkspaceSearchDeps = {
  listFiles?: typeof listFolderDocuments
  listFolders?: typeof listWorkspaceFolders
  listRecentFiles?: typeof listRecentDocuments
  listPeople?: typeof listOrganizationPeople
  listSubmissions?: typeof listSubmissionPage
  listTasks?: typeof listTaskPage
  listTemplates?: typeof listTemplatePage
  loadMembership?: (actor: Actor) => Promise<OrganizationPermissionSubject>
}

/** A search that could not run, with a message safe to show. */
export class WorkspaceSearchError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "WorkspaceSearchError"
    this.statusCode = statusCode
  }
}

// The permission each section's own tab needs.
const PERMISSIONS: Record<WorkspaceSearchKind, OrganizationPermissionAction> = {
  files: "documents:view",
  people: "people:view",
  submissions: "submissions:view",
  tasks: "tasks:view",
  templates: "templates:view",
}

// Across every section a few of each; in one section, a list's worth.
const SHOWN_EACH = 4
const SHOWN_ONE = 20

const inputSchema = z
  .object({
    kind: z.enum(WORKSPACE_SEARCH_KINDS).optional(),
    query: z
      .string()
      .trim()
      .max(100)
      .refine((words) => words.length !== 1),
  })
  // Without words there is nothing to look for until a section is chosen.
  .refine((input) => input.query !== "" || input.kind !== undefined)

type Found = { hits: WorkspaceSearchHit[]; total: number }

function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>
}

// Each section is searched by the service its own list uses, which decides
// what the member may see there. Without words, a section opens a list of
// its own, as Spotlight's categories do: recent files, templates and
// submissions, open tasks soonest due first, and everyone by name.
const FINDERS: Record<WorkspaceSearchKind, (actor: Actor, query: string, limit: number, deps: WorkspaceSearchDeps) => Promise<Found>> = {
  async files(actor, query, limit, deps) {
    if (!query) {
      const recent = await (deps.listRecentFiles ?? listRecentDocuments)({ ...actor, limit })

      return { hits: recent.map((document) => ({ item: pick(document, FIELDS.files), kind: "files" as const })), total: recent.length }
    }

    // As the Files list searches: folders by name, then documents by title,
    // wherever they are filed. ponytail: reads every match to count them, as
    // the list does; a counted, limited read when a library outgrows it.
    const [folders, documents] = await Promise.all([
      (deps.listFolders ?? listWorkspaceFolders)(actor),
      (deps.listFiles ?? listFolderDocuments)({ ...actor, folderIds: [], includeRoot: false, query, visibleFolderIds: [] }),
    ])
    const words = query.toLocaleLowerCase()
    const named = folders.filter((folder) => folder.name.toLocaleLowerCase().includes(words))

    return {
      hits: [
        ...named.slice(0, limit).map((folder) => ({ folder: true as const, item: pick(folder, FIELDS.folders), kind: "files" as const })),
        ...documents
          .slice(0, Math.max(0, limit - named.length))
          .map((document) => ({ item: pick(document, FIELDS.files), kind: "files" as const })),
      ],
      total: named.length + documents.length,
    }
  },
  async people(actor, query, limit, deps) {
    const { members } = await (deps.listPeople ?? listOrganizationPeople)(actor.actorUserId, actor.organizationId)
    // What the People page looked through: names, email and role.
    const words = query.toLowerCase()
    const name = (member: OrganizationMember): string => member.workspaceDisplayName || member.fullName || member.email
    const found = members
      .filter((member) =>
        [member.workspaceDisplayName, member.fullName, member.email, member.roleName ?? ORGANIZATION_ROLE_LABELS[member.role]]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(words)
      )
      .sort((one, other) => name(one).localeCompare(name(other)))

    return {
      hits: found.slice(0, limit).map((member) => ({ item: pick(member, FIELDS.people), kind: "people" })),
      total: found.length,
    }
  },
  async submissions(actor, query, limit, deps) {
    const { submissions, total } = await (deps.listSubmissions ?? listSubmissionPage)({
      ...actor,
      page: 1,
      pageSize: limit,
      query,
      sort: { direction: "desc", key: "updated" },
    })

    return { hits: submissions.map((submission) => ({ item: pick(submission, FIELDS.submissions), kind: "submissions" })), total }
  },
  async tasks(actor, query, limit, deps) {
    const { tasks, total } = await (deps.listTasks ?? listTaskPage)({
      ...actor,
      page: 1,
      pageSize: limit,
      query,
      sort: query ? { direction: "desc", key: "created" } : { direction: "asc", key: "due" },
      statuses: query ? undefined : ["open", "in_progress"],
    })

    return { hits: tasks.map((task) => ({ item: pick(task, FIELDS.tasks), kind: "tasks" })), total }
  },
  async templates(actor, query, limit, deps) {
    const { templates, total } = await (deps.listTemplates ?? listTemplatePage)({
      ...actor,
      page: 1,
      pageSize: limit,
      query,
      sort: { direction: "desc", key: "updated" },
    })

    return { hits: templates.map((template) => ({ item: pick(template, FIELDS.templates), kind: "templates" })), total }
  },
}

/**
 * Searches every section of the workspace the member may open, or one of
 * them, by title, or for people by name, email or role. Each section counts
 * everything it matches; the hits are the first few of each, or of the one.
 * With no words, a chosen section opens its own list instead.
 *
 * @param input - Actor, tenant, the words, and optionally one section.
 * @param deps - Optional membership and list dependencies for tests.
 * @returns The hits, section by section, and each section's total.
 * @throws WorkspaceSearchError for words out of range, no membership, or a
 *   section that failed.
 */
export async function searchWorkspace(
  input: WorkspaceSearchInput,
  deps: WorkspaceSearchDeps = {}
): Promise<WorkspaceSearchResult> {
  const parsed = inputSchema.safeParse({ kind: input.kind ?? undefined, query: input.query ?? "" })

  if (!parsed.success) {
    throw new WorkspaceSearchError("Search for 2 to 100 characters, or choose a section.", 400)
  }

  const { kind, query } = parsed.data
  const actor = { actorUserId: input.actorUserId, organizationId: input.organizationId }
  const membership = await (deps.loadMembership ?? loadMembership)(actor)
  const kinds = WORKSPACE_SEARCH_KINDS.filter((each) => canPerformOrganizationAction(membership, PERMISSIONS[each]))

  // Searching one section still counts the rest for their filters; without
  // words, only the chosen section opens.
  const looked = query ? kinds : kinds.filter((each) => each === kind)

  const settled = await Promise.allSettled(
    looked.map((each) => FINDERS[each](actor, query, kind === undefined ? SHOWN_EACH : each === kind ? SHOWN_ONE : 1, deps))
  )

  const chosenIndex = kind !== undefined ? looked.indexOf(kind) : -1

  if (chosenIndex !== -1 && settled[chosenIndex]!.status === "rejected") {
    const error = settled[chosenIndex]!.reason
    const statusCode = (error as { statusCode?: unknown }).statusCode

    if (error instanceof Error && typeof statusCode === "number" && statusCode < 500) {
      throw new WorkspaceSearchError(error.message, statusCode)
    }

    console.error("workspace_search_service_failed", {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      reason: error instanceof Error ? error.message : "Unknown error",
    })
    throw new WorkspaceSearchError("Search failed. Try again.", 500)
  }

  const fulfilled = settled.filter((result): result is PromiseFulfilledResult<Found> => result.status === "fulfilled")

  if (fulfilled.length === 0) {
    const firstError = settled.find((result): result is PromiseRejectedResult => result.status === "rejected")?.reason
    const statusCode = (firstError as { statusCode?: unknown }).statusCode

    if (firstError instanceof Error && typeof statusCode === "number" && statusCode < 500) {
      throw new WorkspaceSearchError(firstError.message, statusCode)
    }

    console.error("workspace_search_service_failed", {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      reason: firstError instanceof Error ? firstError.message : "Unknown error",
    })
    throw new WorkspaceSearchError("Search failed. Try again.", 500)
  }

  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      const error = result.reason
      const statusCode = (error as { statusCode?: unknown }).statusCode

      if (error instanceof Error && typeof statusCode === "number" && statusCode < 500) {
        console.warn("workspace_search_section_rejected", {
          actorUserId: input.actorUserId,
          organizationId: input.organizationId,
          reason: error.message,
          section: looked[index],
          statusCode,
        })
      } else {
        console.error("workspace_search_section_failed", {
          actorUserId: input.actorUserId,
          organizationId: input.organizationId,
          reason: error instanceof Error ? error.message : "Unknown error",
          section: looked[index],
        })
      }
    }
  })

  const hits: WorkspaceSearchHit[] = []
  const totals: Partial<Record<WorkspaceSearchKind, number>> = {}

  looked.forEach((each, index) => {
    const result = settled[index]!

    if (result.status === "fulfilled") {
      totals[each] = result.value.total
      if (kind === undefined || each === kind) {
        hits.push(...result.value.hits)
      }
    }
  })

  return { hits, totals }
}

async function loadMembership(actor: Actor): Promise<OrganizationPermissionSubject> {
  const context = await getCurrentOrganizationContext(actor.actorUserId)

  if (!context || context.organization.id !== actor.organizationId) {
    throw new WorkspaceSearchError("Create or join an organization before searching.", 403)
  }

  return context.membership
}
