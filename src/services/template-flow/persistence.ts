import { createAdminClient } from "@/lib/supabase/admin"
import { TEMPLATE_FLOW_OPERATION_TYPES } from "@/services/template-ai/flow-response-schema"
import { getTemplateAccess } from "@/services/templates/access"
import type {
  TemplateFlowLedgerItem,
  TemplateFlowMessage,
  TemplateFlowMessageRow,
  TemplateFlowOperationType,
  TemplateFlowProposal,
} from "@/types/template-flow"
import {
  type TemplateFlowClient,
  type TemplateFlowProposalReceipt,
  TemplateFlowServiceError,
} from "@/services/template-flow/contracts"

export function createProposedAssistantContent(
  providerContent: string,
  proposal: TemplateFlowProposal | null
): string {
  if (proposal === null) {
    return providerContent
  }

  const receiptSafeContent = providerContent.replace(
    /\b(applied|implemented)\b/gi,
    "proposed"
  )

  if (/\bpropos(?:e|ed|al)\b/i.test(receiptSafeContent)) {
    return receiptSafeContent
  }

  const changeLabel =
    proposal.operations.length === 1 ? "change is" : "changes are"
  return `${receiptSafeContent}\n\n${proposal.operations.length} ${changeLabel} proposed and awaiting review.`
}

export function createFlowMessages(input: {
  actorUserId: string
  assistantContent: string
  authorName: string
  changedBlockIds: string[]
  createId: () => string
  instruction: string
  ledgerItems: TemplateFlowLedgerItem[]
  now: Date
}): [TemplateFlowMessage, TemplateFlowMessage] {
  const createdAt = input.now.toISOString()

  return [
    {
      id: input.createId(),
      role: "user",
      content: input.instruction,
      authorName: input.authorName,
      operations: [],
      changedBlockIds: [],
      receiptStatus: null,
      createdAt
    },
    {
      id: input.createId(),
      role: "assistant",
      content: input.assistantContent,
      authorName: null,
      operations: input.ledgerItems,
      changedBlockIds: input.changedBlockIds,
      receiptStatus: input.ledgerItems.length > 0 ? "proposed" : null,
      createdAt
    }
  ]
}

/**
 * The client a Flow read goes through: the one a caller was given, or the
 * service-role client.
 *
 * @param client - An injected client, if any.
 * @returns The client to read with.
 */
export function getFlowClient(client?: TemplateFlowClient): TemplateFlowClient {
  return client ?? createAdminClient()
}

export async function requireTemplateManagement(
  input: {
    actorUserId: string
    organizationId: string
    templateId: string
  },
  providedClient?: TemplateFlowClient
): Promise<void> {
  const client: TemplateFlowClient = providedClient ?? createAdminClient()
  const [{ data: membershipData, error: membershipError }, templateResult] =
    await Promise.all([
      client
        .from("organization_memberships")
        .select("status")
        .eq("org_id", input.organizationId)
        .eq("user_id", input.actorUserId)
        .eq("status", "active")
        .maybeSingle(),
      client
        .from("document_templates")
        .select("id,status")
        .eq("org_id", input.organizationId)
        .eq("id", input.templateId)
        .maybeSingle()
    ])

  if (membershipError || templateResult.error) {
    throw new TemplateFlowServiceError(
      "Unable to verify template editing access.",
      500
    )
  }

  const template = templateResult.data as {
    id?: unknown
    status?: unknown
  } | null

  if ((membershipData as { status?: unknown } | null)?.status !== "active") {
    throw new TemplateFlowServiceError(
      "You do not have permission to manage templates.",
      403
    )
  }

  if (!template?.id) {
    throw new TemplateFlowServiceError("Template not found.", 404)
  }

  // Editing is the template's own answer: its maker, an editor it was shared with, or a manager.
  const level = await getTemplateAccess(client, input).catch(() => {
    throw new TemplateFlowServiceError("Unable to verify template editing access.", 500)
  })

  if (level !== "editor") {
    throw new TemplateFlowServiceError("You do not have permission to manage templates.", 403)
  }

  if (template.status === "archived") {
    throw new TemplateFlowServiceError(
      "Archived templates cannot be changed.",
      409
    )
  }
}

export async function loadFlowHistory(
  input: {
    organizationId: string
    templateId: string
  },
  client: TemplateFlowClient = createAdminClient()
): Promise<TemplateFlowMessage[]> {
  const { data, error } = await client
    .from("template_flow_messages")
    .select("*")
    .eq("org_id", input.organizationId)
    .eq("template_id", input.templateId)
    .order("created_at", { ascending: false })
    .limit(100)

  if (error) {
    console.warn("template_flow_history_load_failed", {
      organizationId: input.organizationId,
      templateId: input.templateId,
      reason: error.message
    })
    return []
  }

  return ((data ?? []) as TemplateFlowMessageRow[])
    .reverse()
    .map(mapFlowMessageRow)
}

export async function persistFlowMessages(
  input: {
    messages: [TemplateFlowMessage, TemplateFlowMessage]
    proposalReceipt: TemplateFlowProposalReceipt | null
    organizationId: string
    templateId: string
    actorUserId: string
  },
  client: TemplateFlowClient = createAdminClient()
): Promise<void> {
  const rows = input.messages.map(
    (message: TemplateFlowMessage): TemplateFlowMessageRow => ({
      id: message.id,
      org_id: input.organizationId,
      template_id: input.templateId,
      author_user_id: message.role === "user" ? input.actorUserId : null,
      author_name: message.authorName,
      role: message.role,
      content: message.content,
      change_set:
        message.operations.length > 0 || message.changedBlockIds.length > 0
          ? {
              status: input.proposalReceipt?.status ?? "proposed",
              proposalId: input.proposalReceipt?.proposalId ?? null,
              baseDraftFingerprint:
                input.proposalReceipt?.baseDraftFingerprint ?? null,
              operations: message.operations,
              changedBlockIds: message.changedBlockIds
            }
          : null,
      created_at: message.createdAt
    })
  )
  // tenant-scope: rows are built above with org_id: input.organizationId
  const { error } = await client.from("template_flow_messages").insert(rows)

  if (error) {
    throw new Error(error.message)
  }
}

export async function resolveFlowAuthorName(
  actorUserId: string,
  client: TemplateFlowClient = createAdminClient()
): Promise<string> {
  const { data, error } = await client
    .from("profiles")
    .select("full_name,email")
    .eq("id", actorUserId)
    .maybeSingle()

  if (error) {
    console.warn("template_flow_author_load_failed", {
      actorUserId,
      reason: error.message
    })
    return "Team member"
  }

  const profile = data as { full_name?: unknown; email?: unknown } | null

  if (
    typeof profile?.full_name === "string" &&
    profile.full_name.trim().length > 0
  ) {
    return profile.full_name.trim()
  }

  if (typeof profile?.email === "string" && profile.email.includes("@")) {
    return profile.email.split("@")[0] || "Team member"
  }

  return "Team member"
}

function mapFlowMessageRow(row: TemplateFlowMessageRow): TemplateFlowMessage {
  const changeSet = isRecord(row.change_set) ? row.change_set : {}
  const operations = Array.isArray(changeSet.operations)
    ? changeSet.operations
        .map(parseLedgerItem)
        .filter(
          (
            item: TemplateFlowLedgerItem | null
          ): item is TemplateFlowLedgerItem => item !== null
        )
    : []
  const changedBlockIds = Array.isArray(changeSet.changedBlockIds)
    ? changeSet.changedBlockIds.filter(
        (blockId: unknown): blockId is string => typeof blockId === "string"
      )
    : []

  return {
    id: row.id,
    role: row.role,
    content: row.content,
    authorName: row.author_name,
    operations,
    changedBlockIds,
    receiptStatus: operations.length > 0 ? "proposed" : null,
    createdAt: row.created_at
  }
}

function parseLedgerItem(value: unknown): TemplateFlowLedgerItem | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    !TEMPLATE_FLOW_OPERATION_TYPES.includes(
      value.type as TemplateFlowOperationType
    ) ||
    typeof value.summary !== "string" ||
    typeof value.target !== "string" ||
    !Array.isArray(value.affectedBlockIds)
  ) {
    return null
  }

  return {
    id: value.id,
    type: value.type as TemplateFlowOperationType,
    summary: value.summary,
    target: value.target,
    affectedBlockIds: value.affectedBlockIds.filter(
      (blockId: unknown): blockId is string => typeof blockId === "string"
    ),
    dependsOn: Array.isArray(value.dependsOn) ? value.dependsOn.filter(Number.isInteger) : []
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
