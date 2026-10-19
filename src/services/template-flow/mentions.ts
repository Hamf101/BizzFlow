import { collectFields } from "@/services/document-signing/answer-validation"
import { requireDocumentAccess } from "@/services/documents/access-service"
import { getDocumentById } from "@/services/documents/shared"
import { listOrganizationPeople } from "@/services/organization-service"
import { ServiceError } from "@/services/service-error"
import { getInternalSubmission } from "@/services/submission-service"
import { getTask } from "@/services/task-service"
import { type FlowMention } from "@/services/template-flow/contracts"
import { getFlowClient } from "@/services/template-flow/persistence"
import { getDocumentTemplate } from "@/services/template-service"
import { ORGANIZATION_ROLE_LABELS } from "@/lib/permissions"
import type { TemplateContent } from "@/types/template"
import { isTemplateFieldBlock } from "@/types/template-structure"

/** A mentioned item as Flow reads it: its name and a few facts, never more than it needs. */
export type ResolvedFlowMention = Readonly<{ details: string; kind: FlowMention["kind"]; name: string }>

type Actor = Readonly<{ actorUserId: string; organizationId: string }>

/** Each loader goes through the service that decides what the member may open. */
export type FlowMentionDeps = {
  loadFile?: (input: Actor & { id: string }) => Promise<{ description: string | null; title: string }>
  loadPeople?: (input: Actor) => Promise<ReadonlyArray<{ email: string; id: string; name: string; role: string }>>
  loadSubmission?: (input: Actor & { id: string }) => Promise<{ content: TemplateContent; status: string; title: string; values: Record<string, unknown> }>
  loadTask?: (input: Actor & { id: string }) => Promise<{ description: string | null; dueAt: string | null; status: string; title: string }>
  loadTemplate?: (input: Actor & { id: string }) => Promise<{ content: TemplateContent; status: string; title: string }>
}

const MAX_DETAILS = 1_200
const MAX_ANSWER = 120

/**
 * Turns what a member mentioned into short facts for Flow. Each item is read
 * through its own service, as the member, so one they cannot open is left out
 * without a word about it: Flow never learns it exists.
 *
 * @param input - Actor, tenant, and the parsed mentions.
 * @param deps - Optional loaders for tests.
 * @returns The items the member may open, in the order mentioned.
 */
export async function resolveFlowMentions(
  input: Actor & { mentions: readonly FlowMention[] },
  deps: FlowMentionDeps = {}
): Promise<ResolvedFlowMention[]> {
  const actor = { actorUserId: input.actorUserId, organizationId: input.organizationId }
  // One people list serves every person mentioned.
  let people: ReturnType<NonNullable<FlowMentionDeps["loadPeople"]>> | null = null
  const resolved = await Promise.all(
    input.mentions.map(async (mention): Promise<ResolvedFlowMention | null> => {
      try {
        switch (mention.kind) {
          case "templates": {
            const template = await (deps.loadTemplate ?? loadTemplate)({ ...actor, id: mention.id })
            return found(mention, template.title, `Template, ${template.status}. Holds: ${outline(template.content)}`)
          }
          case "submissions": {
            const submission = await (deps.loadSubmission ?? loadSubmission)({ ...actor, id: mention.id })
            return found(mention, submission.title, `Submission, ${submission.status}. Answers: ${answers(submission.content, submission.values)}`)
          }
          case "tasks": {
            const task = await (deps.loadTask ?? loadTask)({ ...actor, id: mention.id })
            const due = task.dueAt ? `, due ${task.dueAt.slice(0, 10)}` : ""
            return found(mention, task.title, `Task, ${task.status}${due}${task.description ? `. ${task.description}` : ""}`)
          }
          case "files": {
            const file = await (deps.loadFile ?? loadFile)({ ...actor, id: mention.id })
            return found(mention, file.title, `File${file.description ? `. ${file.description}` : ""}`)
          }
          case "people": {
            people ??= (deps.loadPeople ?? loadPeople)(actor)
            const person = (await people).find((member) => member.id === mention.id)
            return person ? found(mention, person.name, `Person, ${person.role}, ${person.email}`) : null
          }
        }
      } catch (error: unknown) {
        // Refused or missing reads the same as never mentioned; anything else is worth a line in the logs.
        if (!(error instanceof ServiceError && (error.statusCode === 403 || error.statusCode === 404))) {
          console.warn("flow_mention_unresolved", { kind: mention.kind, reason: error instanceof Error ? error.name : "unknown" })
        }
        return null
      }
    })
  )

  return resolved.filter((mention): mention is ResolvedFlowMention => mention !== null)
}

function found(mention: FlowMention, name: string, details: string): ResolvedFlowMention {
  return { details: details.slice(0, MAX_DETAILS), kind: mention.kind, name }
}

function outline(content: TemplateContent): string {
  return content.blocks
    .flatMap((block) => (block.type === "heading" ? [block.text] : isTemplateFieldBlock(block) ? [`${block.label} (${block.type})`] : []))
    .join("; ")
}

function answers(content: TemplateContent, values: Record<string, unknown>): string {
  return [...collectFields(content).values()]
    .filter((field) => typeof values[field.fieldKey] === "string" || typeof values[field.fieldKey] === "number" || typeof values[field.fieldKey] === "boolean")
    .map((field) => `${field.label}: ${String(values[field.fieldKey]).slice(0, MAX_ANSWER)}`)
    .join("; ")
}

async function loadTemplate(input: Actor & { id: string }): ReturnType<NonNullable<FlowMentionDeps["loadTemplate"]>> {
  const template = await getDocumentTemplate({ actorUserId: input.actorUserId, organizationId: input.organizationId, templateId: input.id })
  return { content: template.content as TemplateContent, status: template.status, title: template.title }
}

async function loadSubmission(input: Actor & { id: string }): ReturnType<NonNullable<FlowMentionDeps["loadSubmission"]>> {
  const { submission } = await getInternalSubmission({ actorUserId: input.actorUserId, organizationId: input.organizationId, submissionId: input.id })
  return { content: submission.templateSnapshot, status: submission.status, title: submission.title, values: submission.values }
}

async function loadTask(input: Actor & { id: string }): ReturnType<NonNullable<FlowMentionDeps["loadTask"]>> {
  const { task } = await getTask({ actorUserId: input.actorUserId, organizationId: input.organizationId, taskId: input.id })
  return { description: task.description, dueAt: task.dueAt, status: task.status, title: task.title }
}

async function loadFile(input: Actor & { id: string }): ReturnType<NonNullable<FlowMentionDeps["loadFile"]>> {
  const client = getFlowClient()
  await requireDocumentAccess(
    { actorUserId: input.actorUserId, documentId: input.id, operation: "read", organizationId: input.organizationId, requiredAccess: "viewer", requiredOrganizationPermissionAction: "documents:view" },
    client
  )
  const document = await getDocumentById(client, input.organizationId, input.id)

  if (document.lifecycleState === "trashed" || document.lifecycleState === "purge_pending") {
    throw new ServiceError("Document was not found.", 404)
  }

  return { description: document.description, title: document.title }
}

async function loadPeople(input: Actor): ReturnType<NonNullable<FlowMentionDeps["loadPeople"]>> {
  const { members } = await listOrganizationPeople(input.actorUserId, input.organizationId)
  return members.map((member) => ({
    email: member.email,
    id: member.id,
    name: member.workspaceDisplayName || member.fullName || member.email,
    role: member.roleName ?? ORGANIZATION_ROLE_LABELS[member.role],
  }))
}
