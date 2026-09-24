import { randomUUID } from "node:crypto"

import { z } from "zod"

import {
  canPerformOrganizationAction,
  type OrganizationPermissionSubject,
} from "@/lib/permissions"
import type { AiRuntime } from "@/services/ai/contracts"
import { AI_PROVIDER_ERROR_CODES, AiProviderError } from "@/services/ai/errors"
import { createAiRuntime } from "@/services/ai/provider-factory"
import { listFolderDocuments, listRecentDocuments } from "@/services/document-service"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import { listSubmissionPage } from "@/services/submission-service"
import { listTaskPage } from "@/services/task-service"
import { TemplateFlowServiceError } from "@/services/template-flow-service"
import { listTemplatePage } from "@/services/template-service"
import type { AccessibleDocumentSummary } from "@/types/document"
import type { Submission, SubmissionStatus } from "@/types/submission"
import type { Task } from "@/types/task"
import type { DocumentTemplateCard } from "@/types/template"

const DAY_MS = 86_400_000
const SHOWN = 8

/** One piece of work Flow found, ready to draw as a link. */
export type WorkspaceFlowItem = Readonly<{ href: string; id: string; meta: string; title: string }>

/** What Flow does with a message sent from a workspace page. */
export type WorkspaceFlowAnswer =
  | Readonly<{ kind: "create"; reply: string; target: "document" | "template"; title: string }>
  | Readonly<{ items: readonly WorkspaceFlowItem[]; kind: "found"; moreHref: string; reply: string }>
  | Readonly<{ kind: "reply"; reply: string }>

export type WorkspaceFlowInput = {
  actorUserId: string
  /** Earlier turns, as the browser kept them; context for the plan only. */
  history: unknown
  message: unknown
  organizationId: string
}

type Actor = { actorUserId: string; organizationId: string }

export type WorkspaceFlowDeps = {
  createTraceId?: () => string
  getAiRuntime?: () => AiRuntime
  listTasks?: (input: Actor & { assignedTo?: string; query?: string }) => Promise<Task[]>
  listSubmissions?: (
    input: Actor & { createdBy?: string; query?: string; statuses: readonly SubmissionStatus[] }
  ) => Promise<Submission[]>
  listTemplates?: (input: Actor & { query?: string }) => Promise<DocumentTemplateCard[]>
  loadMembership?: (input: Actor) => Promise<OrganizationPermissionSubject>
  now?: () => Date
  searchFiles?: (input: Actor & { query?: string }) => Promise<AccessibleDocumentSummary[]>
}

const messageSchema = z.string().trim().min(2).max(2_000)
const historySchema = z
  .array(z.object({ role: z.enum(["member", "flow"]), text: z.string().max(2_000) }))
  .max(8)
  .catch([])

const SUBJECTS = ["tasks", "submissions", "files", "templates", "none"] as const
const FILTERS = ["overdue", "due_soon", "needs_review", "needs_changes", "drafts", "decided", "any"] as const

const planSchema = z.object({
  action: z.enum(["find", "create", "none"]),
  filter: z.enum(FILTERS).catch("any"),
  mine: z.boolean().catch(false),
  query: z.string().max(120).catch(""),
  reply: z.string().max(600),
  subject: z.enum(SUBJECTS).catch("none"),
  target: z.enum(["template", "document", "none"]).catch("none"),
  title: z.string().max(120).catch(""),
})

type Plan = z.infer<typeof planSchema>

const PLAN_SCHEMA = {
  properties: {
    action: { enum: ["find", "create", "none"], type: "string" },
    filter: { enum: [...FILTERS], type: "string" },
    mine: { type: "boolean" },
    query: { type: "string" },
    reply: { type: "string" },
    subject: { enum: [...SUBJECTS], type: "string" },
    target: { enum: ["template", "document", "none"], type: "string" },
    title: { type: "string" },
  },
  required: ["action", "reply", "subject", "filter", "mine", "query", "target", "title"],
  type: "object",
}

const SUBMISSION_FILTERS: Partial<Record<Plan["filter"], readonly SubmissionStatus[]>> = {
  decided: ["approved", "rejected", "completed"],
  drafts: ["draft"],
  needs_changes: ["needs_changes"],
  needs_review: ["submitted", "in_review"],
}
const SUBMISSION_VIEWS: Partial<Record<Plan["filter"], string>> = {
  decided: "decided",
  drafts: "draft",
  needs_changes: "needs_changes",
  needs_review: "submitted",
}
const STATUS_LABELS: Record<string, string> = {
  approved: "Approved",
  archived: "Archived",
  completed: "Completed",
  draft: "Draft",
  in_review: "In review",
  needs_changes: "Needs changes",
  published: "Published",
  rejected: "Rejected",
  submitted: "Submitted",
}
// [one, many] for each thing Flow can count.
const NOUNS: Record<string, readonly [string, string]> = {
  "files:any": ["file", "files"],
  "submissions:any": ["submission", "submissions"],
  "submissions:decided": ["decided submission", "decided submissions"],
  "submissions:drafts": ["draft", "drafts"],
  "submissions:needs_changes": ["submission returned for changes", "submissions returned for changes"],
  "submissions:needs_review": ["submission waiting for review", "submissions waiting for review"],
  "tasks:any": ["open task", "open tasks"],
  "tasks:due_soon": ["task due this week", "tasks due this week"],
  "tasks:overdue": ["overdue task", "overdue tasks"],
  "templates:any": ["template", "templates"],
}

/**
 * Completes one Flow turn from a workspace page. One model call reads the
 * message into a plan; anything Flow reports about the member's work comes
 * from the services that already decide what they may see, and the words
 * that report it are chosen here from those results, never by the model.
 *
 * @param input - Actor, tenant, the message, and the conversation so far.
 * @param deps - Optional runtime, permission and list dependencies for tests.
 * @returns Work found, something to start, or a short reply.
 * @throws TemplateFlowServiceError for an invalid message or a Flow failure.
 */
export async function executeWorkspaceFlow(
  input: WorkspaceFlowInput,
  deps: WorkspaceFlowDeps = {}
): Promise<WorkspaceFlowAnswer> {
  const message = messageSchema.safeParse(input.message)

  if (!message.success) {
    throw new TemplateFlowServiceError("Write a message of 2 to 2,000 characters.", 400)
  }

  const actor = { actorUserId: input.actorUserId, organizationId: input.organizationId }
  const membership = await (deps.loadMembership ?? loadMembership)(actor)
  const creatable = (["template", "document"] as const).filter((target) =>
    canPerformOrganizationAction(membership, target === "template" ? "templates:manage" : "documents:create")
  )
  const plan = await requestPlan(message.data, historySchema.parse(input.history), creatable, deps)

  if (plan.action === "create") {
    const target = creatable.includes(plan.target as "template") ? plan.target : creatable[0]

    return target && target !== "none"
      ? { kind: "create", reply: plan.reply, target, title: plan.title.trim() || "Untitled" }
      : { kind: "reply", reply: "Your role can't start templates or documents. Ask a manager." }
  }

  if (plan.action === "find" && plan.subject !== "none") {
    try {
      return await find(plan, actor, deps, (deps.now ?? (() => new Date()))())
    } catch (error: unknown) {
      // Each list decides what a role may see; Flow says so rather than failing.
      if (error instanceof Error && (error as { statusCode?: unknown }).statusCode === 403) {
        return { kind: "reply", reply: `Your role can't see ${plan.subject}.` }
      }

      throw error
    }
  }

  return { kind: "reply", reply: plan.reply }
}

async function find(plan: Plan, actor: Actor, deps: WorkspaceFlowDeps, now: Date): Promise<WorkspaceFlowAnswer> {
  const query = plan.query.trim() || undefined
  let filter = plan.filter
  let items: WorkspaceFlowItem[]
  let moreHref: string

  if (plan.subject === "tasks") {
    filter = filter === "overdue" || filter === "due_soon" ? filter : "any"
    const tasks = await (deps.listTasks ?? listTasks)({ ...actor, assignedTo: plan.mine ? actor.actorUserId : undefined, query })
    items = tasks
      .filter((task) => {
        const due = task.dueAt ? Date.parse(task.dueAt) : Number.NaN
        return filter === "overdue" ? due < now.getTime() : filter === "due_soon" ? due >= now.getTime() && due < now.getTime() + 7 * DAY_MS : true
      })
      .sort((left, right) => Date.parse(left.dueAt ?? "9999") - Date.parse(right.dueAt ?? "9999"))
      .map((task) => ({
        href: `/tasks/${encodeURIComponent(task.id)}`,
        id: task.id,
        meta: task.dueAt ? `Due ${formatDay(task.dueAt)}` : "No due date",
        title: task.title,
      }))
    moreHref = "/tasks"
  } else if (plan.subject === "submissions") {
    filter = SUBMISSION_FILTERS[filter] ? filter : "any"
    const submissions = await (deps.listSubmissions ?? listSubmissions)({
      ...actor,
      createdBy: plan.mine ? actor.actorUserId : undefined,
      query,
      statuses: SUBMISSION_FILTERS[filter] ?? ["draft", "submitted", "in_review", "needs_changes"],
    })
    items = submissions.map((submission) => ({
      href: `/submissions/${encodeURIComponent(submission.id)}`,
      id: submission.id,
      meta: STATUS_LABELS[submission.status] ?? submission.status,
      title: submission.title,
    }))
    moreHref = SUBMISSION_VIEWS[filter] ? `/submissions?status=${SUBMISSION_VIEWS[filter]}` : "/submissions"
  } else if (plan.subject === "files") {
    filter = "any"
    const documents = await (deps.searchFiles ?? searchFiles)({ ...actor, query })
    items = documents.map((document) => ({
      href:
        document.sourceKind === "generated" && document.lifecycleState === "active"
          ? `/documents/${encodeURIComponent(document.id)}/edit`
          : `/documents/${encodeURIComponent(document.id)}`,
      id: document.id,
      meta: `Edited ${formatDay(document.updatedAt)}`,
      title: document.title,
    }))
    moreHref = "/documents"
  } else {
    filter = "any"
    const templates = await (deps.listTemplates ?? listTemplates)({ ...actor, query })
    items = templates.map((template) => ({
      href: `/templates/${encodeURIComponent(template.id)}/edit`,
      id: template.id,
      meta: STATUS_LABELS[template.status] ?? template.status,
      title: template.title,
    }))
    moreHref = "/templates"
  }

  const [one, many] = NOUNS[`${plan.subject}:${filter}`] ?? ["result", "results"]
  const matching = query ? ` matching “${query}”` : ""
  const reply = items.length === 0 ? `No ${many}${matching}.` : `${items.length} ${items.length === 1 ? one : many}${matching}`

  return { items: items.slice(0, SHOWN), kind: "found", moreHref, reply }
}

async function requestPlan(
  message: string,
  history: z.infer<typeof historySchema>,
  creatable: readonly ("document" | "template")[],
  deps: WorkspaceFlowDeps
): Promise<Plan> {
  let runtime: AiRuntime

  try {
    runtime = (deps.getAiRuntime ?? createAiRuntime)()
  } catch {
    throw new TemplateFlowServiceError("Flow is not configured. Add the AI environment variables.", 503)
  }

  const conversation = history.map((turn) => `${turn.role === "flow" ? "Flow" : "Member"}: ${turn.text}`).join("\n")

  try {
    const result = await runtime.provider.generateStructured({
      input: `${conversation ? `Conversation so far:\n${conversation}\n\n` : ""}Latest message:\n${message}`,
      maxOutputTokens: 400,
      model: runtime.model,
      responseSchema: PLAN_SCHEMA,
      systemInstruction: [
        "You are Flow, the assistant inside BizFlow: a workspace of templates (reusable forms and documents), documents, submissions (filled-in forms moving through review), tasks, and files.",
        "Read the member's latest message and choose one action.",
        "find: they want to see or find their work. Choose subject and filter; put words to look for in titles in query, or leave it empty; mine is true when they mean their own work.",
        `create: they want something new made. target is template for anything reused or filled in many times, document for a one-off. title is short. They may create: ${creatable.join(" and ") || "nothing"}.`,
        "none: anything else. Reply in one or two sentences with what you can do: find their work, or start a template or document.",
        "Never state counts, names, dates, or other facts about their work: the app shows what it finds. For create, reply with one short sentence saying what you will start.",
      ].join("\n"),
      traceId: deps.createTraceId?.() ?? randomUUID(),
    })

    return planSchema.parse(JSON.parse(result.text))
  } catch (error: unknown) {
    if (error instanceof AiProviderError && error.code === AI_PROVIDER_ERROR_CODES.RATE_LIMITED) {
      throw new TemplateFlowServiceError("Flow is busy. Wait a minute and try again.", 429)
    }

    console.error("workspace_flow_plan_failed", {
      reason: error instanceof Error ? error.name : "Unknown error",
    })
    throw new TemplateFlowServiceError("Flow couldn't answer that. Try again shortly.", 502)
  }
}

async function loadMembership(actor: Actor): Promise<OrganizationPermissionSubject> {
  const context = await getCurrentOrganizationContext(actor.actorUserId)

  if (!context || context.organization.id !== actor.organizationId) {
    throw new TemplateFlowServiceError("Create or join an organization before using Flow.", 403)
  }

  return context.membership
}

async function listTasks(input: Actor & { assignedTo?: string; query?: string }): Promise<Task[]> {
  return (
    await listTaskPage({ ...input, page: 1, pageSize: 50, sort: { direction: "asc", key: "due" }, statuses: ["open", "in_progress"] })
  ).tasks
}

async function listSubmissions(
  input: Actor & { createdBy?: string; query?: string; statuses: readonly SubmissionStatus[] }
): Promise<Submission[]> {
  return (await listSubmissionPage({ ...input, page: 1, pageSize: SHOWN, sort: { direction: "desc", key: "updated" } }))
    .submissions
}

async function listTemplates(input: Actor & { query?: string }): Promise<DocumentTemplateCard[]> {
  return (await listTemplatePage({ ...input, page: 1, pageSize: SHOWN, sort: { direction: "desc", key: "updated" } }))
    .templates
}

// Without words to look for, the newest files stand in for a search.
async function searchFiles(input: Actor & { query?: string }): Promise<AccessibleDocumentSummary[]> {
  return input.query
    ? listFolderDocuments({ ...input, folderIds: [], includeRoot: false, visibleFolderIds: [] })
    : listRecentDocuments({ ...input, limit: SHOWN })
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", weekday: "short" }).format(new Date(value))
}
