import { randomUUID } from "node:crypto"

import { z } from "zod"

import { getOpenRouterEnv, type OpenRouterEnv } from "@/lib/env"
import {
  createAdminClient,
  type AdminSupabaseClient,
} from "@/lib/supabase/admin"
import {
  templateBlockSchema,
  templateContentSchema,
  type TemplateBlock,
  type TemplateContent,
} from "@/types/template"

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
const MAX_AI_CONTEXT_CHARACTERS = 45_000

const sectionNameSchema = z.enum(["header", "body", "footer"])
const alignmentSchema = z.enum(["left", "center", "right"])
const fieldKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/)

const proposedFieldShape = {
  fieldKey: fieldKeySchema,
  label: z.string().trim().min(1).max(160),
  required: z.boolean(),
  helpText: z.string().trim().max(500).nullable(),
} as const

const proposedBlockSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("heading"),
      text: z.string().trim().min(1).max(500),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      alignment: alignmentSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("paragraph"),
      text: z.string().trim().max(20_000),
      alignment: alignmentSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("bullet_list"),
      items: z.array(z.string().trim().min(1).max(2_000)).min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("numbered_list"),
      items: z.array(z.string().trim().min(1).max(2_000)).min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("table"),
      headers: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
      rows: z
        .array(z.array(z.string().trim().max(2_000)).min(1).max(12))
        .max(100),
    })
    .strict()
    .refine(
      (block): boolean =>
        block.rows.every((row: string[]): boolean =>
          row.length === block.headers.length
        ),
      { message: "Every table row must match the header column count." }
    ),
  z.object({ type: z.literal("divider") }).strict(),
  z
    .object({
      ...proposedFieldShape,
      type: z.literal("text_field"),
      placeholder: z.string().trim().max(240).nullable(),
      multiline: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...proposedFieldShape,
      type: z.literal("date_field"),
    })
    .strict(),
  z
    .object({
      ...proposedFieldShape,
      type: z.literal("checkbox_field"),
      checkedByDefault: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...proposedFieldShape,
      type: z.literal("dropdown_field"),
      placeholder: z.string().trim().max(240).nullable(),
      options: z.array(z.string().trim().min(1).max(240)).min(1).max(100),
    })
    .strict(),
  z
    .object({
      ...proposedFieldShape,
      type: z.literal("initials_field"),
    })
    .strict(),
  z
    .object({
      ...proposedFieldShape,
      type: z.literal("signature_field"),
    })
    .strict(),
])

const openRouterProposalSchema = z
  .object({
    proposals: z.array(proposedBlockSchema).min(1).max(4),
  })
  .strict()

const suggestionInputSchema = z
  .object({
    actorUserId: z.string().trim().min(1),
    organizationId: z.string().trim().min(1),
    draft: z
      .object({
        title: z.string().trim().min(1).max(160),
        description: z.string().trim().max(1_000).nullable(),
        content: templateContentSchema,
      })
      .strict(),
    section: sectionNameSchema,
    instruction: z.string().trim().min(3).max(1_200),
  })
  .strict()

type TemplateAiClient = Pick<AdminSupabaseClient, "from">
type SuggestedBlockInput = z.infer<typeof proposedBlockSchema>

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | null
      refusal?: string | null
    }
  }>
}

export type TemplateSectionName = z.infer<typeof sectionNameSchema>

export type SuggestTemplateBlocksInput = {
  actorUserId: string
  organizationId: string
  draft: unknown
  section: unknown
  instruction: unknown
}

export type TemplateAiServiceDeps = {
  authorizeTemplateManagement?: (input: {
    actorUserId: string
    organizationId: string
  }) => Promise<void>
  createId?: () => string
  fetchImpl?: typeof fetch
  getConfig?: () => OpenRouterEnv
}

/** Error raised when a template block suggestion cannot be completed. */
export class TemplateAiServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates a user-safe AI service error.
   *
   * @param message - Safe message suitable for an API response.
   * @param statusCode - HTTP-style status code for route translation.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "TemplateAiServiceError"
    this.statusCode = statusCode
  }
}

/**
 * Proposes one to four guided document blocks using the current draft as context.
 * The returned blocks are proposals only; this function never mutates a template.
 *
 * @param input - Actor, active organization, current draft, target section, and request.
 * @param deps - Optional authorization, id, configuration, and fetch dependencies.
 * @returns Canonical blocks with server-generated identifiers.
 * @throws TemplateAiServiceError for validation, authorization, or provider failures.
 */
export async function suggestTemplateBlocks(
  input: SuggestTemplateBlocksInput,
  deps: TemplateAiServiceDeps = {}
): Promise<TemplateBlock[]> {
  const startedAt = performance.now()
  const parsedInput = suggestionInputSchema.safeParse(input)

  if (!parsedInput.success) {
    throw new TemplateAiServiceError(
      parsedInput.error.issues[0]?.message ?? "Invalid AI suggestion request.",
      400
    )
  }

  const request = parsedInput.data

  try {
    await (deps.authorizeTemplateManagement ?? requireTemplateManager)({
      actorUserId: request.actorUserId,
      organizationId: request.organizationId,
    })
  } catch (error: unknown) {
    if (error instanceof TemplateAiServiceError) {
      throw error
    }

    console.error("template_ai_authorization_failed", {
      actorUserId: request.actorUserId,
      organizationId: request.organizationId,
      durationMs: Math.round(performance.now() - startedAt),
      reason: error instanceof Error ? error.message : "Unknown authorization error",
    })
    throw new TemplateAiServiceError(
      "Unable to verify template editing access.",
      500
    )
  }

  let config: OpenRouterEnv

  try {
    config = (deps.getConfig ?? getOpenRouterEnv)()
  } catch (error: unknown) {
    console.error("template_ai_configuration_failed", {
      actorUserId: request.actorUserId,
      organizationId: request.organizationId,
      durationMs: Math.round(performance.now() - startedAt),
      reason: error instanceof Error ? error.message : "Unknown configuration error",
    })
    throw new TemplateAiServiceError(
      "AI suggestions are not configured. Add the OpenRouter environment variables.",
      503
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout((): void => controller.abort(), config.OPENROUTER_TIMEOUT_MS)
  const modelContext = buildModelDocumentContext(request.draft.content)
  const fetchImpl = deps.fetchImpl ?? fetch

  try {
    const response = await fetchImpl(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://bizflow.local",
        "X-Title": "BizFlow document template editor",
      },
      body: JSON.stringify({
        model: config.OPENROUTER_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You design concise business-document blocks. Propose only blocks that add useful structure or fillable information, avoid duplicating existing content, use plain professional language, and follow the requested section. Return only the structured response.",
          },
          {
            role: "user",
            content: JSON.stringify({
              documentTitle: request.draft.title,
              documentDescription: request.draft.description,
              selectedSection: request.section,
              instruction: request.instruction,
              currentDocument: modelContext,
            }),
          },
        ],
        provider: {
          require_parameters: true,
          data_collection: "deny",
        },
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "bizflow_template_block_proposals",
            strict: true,
            schema: z.toJSONSchema(openRouterProposalSchema),
          },
        },
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      console.error("template_ai_provider_rejected", {
        actorUserId: request.actorUserId,
        organizationId: request.organizationId,
        model: config.OPENROUTER_MODEL,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
      })
      throw new TemplateAiServiceError(
        "The AI provider could not create suggestions. Try again shortly.",
        502
      )
    }

    const responseBody = (await response.json()) as OpenRouterResponse
    const rawContent = responseBody.choices?.[0]?.message?.content
    const refusal = responseBody.choices?.[0]?.message?.refusal

    if (refusal || typeof rawContent !== "string" || rawContent.length === 0) {
      throw new TemplateAiServiceError(
        "The AI provider did not return usable suggestions.",
        502
      )
    }

    let decodedContent: unknown

    try {
      decodedContent = JSON.parse(rawContent) as unknown
    } catch {
      throw new TemplateAiServiceError(
        "The AI provider returned an invalid suggestion format.",
        502
      )
    }

    const proposalResult = openRouterProposalSchema.safeParse(decodedContent)

    if (!proposalResult.success) {
      throw new TemplateAiServiceError(
        "The AI provider returned suggestions that failed validation.",
        502
      )
    }

    const existingFieldKeys = collectFieldKeys(request.draft.content)
    const createId = deps.createId ?? randomUUID
    const proposals = proposalResult.data.proposals.map(
      (proposal: SuggestedBlockInput): TemplateBlock => {
        const normalizedProposal = normalizeProposedFieldKey(
          proposal,
          existingFieldKeys
        )
        return templateBlockSchema.parse({
          ...normalizedProposal,
          id: createId(),
        })
      }
    )

    console.info("template_ai_suggestions_created", {
      actorUserId: request.actorUserId,
      organizationId: request.organizationId,
      model: config.OPENROUTER_MODEL,
      section: request.section,
      proposalCount: proposals.length,
      durationMs: Math.round(performance.now() - startedAt),
    })

    return proposals
  } catch (error: unknown) {
    if (error instanceof TemplateAiServiceError) {
      throw error
    }

    const timedOut =
      error instanceof Error &&
      (error.name === "AbortError" || controller.signal.aborted)

    console.error("template_ai_request_failed", {
      actorUserId: request.actorUserId,
      organizationId: request.organizationId,
      model: config.OPENROUTER_MODEL,
      durationMs: Math.round(performance.now() - startedAt),
      timedOut,
      reason: error instanceof Error ? error.message : "Unknown provider error",
    })
    throw new TemplateAiServiceError(
      timedOut
        ? "AI suggestions timed out. Try a shorter request."
        : "Unable to create AI suggestions. Try again shortly.",
      timedOut ? 504 : 502
    )
  } finally {
    clearTimeout(timeout)
  }
}

async function requireTemplateManager(input: {
  actorUserId: string
  organizationId: string
}): Promise<void> {
  const client: TemplateAiClient = createAdminClient()
  const { data, error } = await client
    .from("organization_memberships")
    .select("role,status")
    .eq("org_id", input.organizationId)
    .eq("user_id", input.actorUserId)
    .eq("status", "active")
    .maybeSingle()

  if (error) {
    throw new TemplateAiServiceError(
      "Unable to verify template editing access.",
      500
    )
  }

  const membership = data as { role?: unknown; status?: unknown } | null

  if (
    membership?.status !== "active" ||
    (membership.role !== "owner_admin" && membership.role !== "manager")
  ) {
    throw new TemplateAiServiceError(
      "Only organization owners and managers can request template suggestions.",
      403
    )
  }
}

function collectFieldKeys(content: TemplateContent): Set<string> {
  const fieldKeys = new Set<string>()

  for (const section of Object.values(content.sections)) {
    for (const block of section.blocks) {
      if ("fieldKey" in block) {
        fieldKeys.add(block.fieldKey.toLowerCase())
      }
    }
  }

  return fieldKeys
}

function normalizeProposedFieldKey(
  proposal: SuggestedBlockInput,
  usedFieldKeys: Set<string>
): SuggestedBlockInput {
  if (!("fieldKey" in proposal)) {
    return proposal
  }

  const originalKey = proposal.fieldKey
  let candidate = originalKey
  let suffix = 2

  while (usedFieldKeys.has(candidate.toLowerCase())) {
    const suffixText = `_${suffix}`
    candidate = `${originalKey.slice(0, 80 - suffixText.length)}${suffixText}`
    suffix += 1
  }

  usedFieldKeys.add(candidate.toLowerCase())
  return { ...proposal, fieldKey: candidate }
}

function buildModelDocumentContext(content: TemplateContent): Record<string, unknown> {
  let usedCharacters = 0
  const sections: Record<string, { blocks: unknown[]; omittedBlockCount: number }> = {}

  for (const [sectionName, section] of Object.entries(content.sections)) {
    const blocks: unknown[] = []
    let omittedBlockCount = 0

    for (const block of section.blocks) {
      const sanitizedBlock = sanitizeBlockForModel(block)
      const characterCount = JSON.stringify(sanitizedBlock).length

      if (usedCharacters + characterCount > MAX_AI_CONTEXT_CHARACTERS) {
        omittedBlockCount += 1
        continue
      }

      usedCharacters += characterCount
      blocks.push(sanitizedBlock)
    }

    sections[sectionName] = { blocks, omittedBlockCount }
  }

  return {
    branding: {
      organizationName: content.branding.organizationName,
      primaryColor: content.branding.primaryColor,
      accentColor: content.branding.accentColor,
      hasLogo: content.branding.logoDataUrl !== null,
    },
    repeat: content.repeat,
    sections,
  }
}

function sanitizeBlockForModel(block: TemplateBlock): Record<string, unknown> {
  if (block.type === "image") {
    return {
      type: block.type,
      altText: block.altText,
      caption: block.caption,
      alignment: block.alignment,
      widthPercent: block.widthPercent,
      imageDataOmitted: true,
    }
  }

  if (block.type === "paragraph") {
    return { ...block, text: truncateText(block.text, 2_000) }
  }

  if (block.type === "bullet_list" || block.type === "numbered_list") {
    return {
      ...block,
      items: block.items.slice(0, 30).map((item: string): string =>
        truncateText(item, 500)
      ),
      omittedItemCount: Math.max(0, block.items.length - 30),
    }
  }

  if (block.type === "table") {
    return {
      ...block,
      headers: block.headers.map((header: string): string =>
        truncateText(header, 200)
      ),
      rows: block.rows.slice(0, 12).map((row: string[]): string[] =>
        row.map((cell: string): string => truncateText(cell, 300))
      ),
      omittedRowCount: Math.max(0, block.rows.length - 12),
    }
  }

  return block
}

function truncateText(value: string, maximumLength: number): string {
  return value.length <= maximumLength
    ? value
    : `${value.slice(0, maximumLength - 1)}…`
}
