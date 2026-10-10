import { z } from "zod"
import { uuidSchema } from "@/types/schemas"

import { type AdminSupabaseClient } from "@/lib/supabase/admin"
import { flowModelSchema } from "@/services/ai/approved-models"
import { type AiModelReference, type AiRuntime, type AiTokenUsage } from "@/services/ai/contracts"
import { TEMPLATE_FLOW_OPERATION_TYPES } from "@/services/template-ai/flow-response-schema"
import {
  bulletListBlockObjectSchema,
  checkboxFieldBlockSchema,
  dateFieldBlockSchema,
  dividerBlockSchema,
  dropdownFieldBlockSchema,
  fileFieldBlockSchema,
  headingBlockObjectSchema,
  initialsFieldBlockSchema,
  MAX_ROW_COLUMNS,
  numberedListBlockObjectSchema,
  paragraphBlockObjectSchema,
  signatureFieldBlockSchema,
  tableBlockSchema,
  templateContentSchema,
  templateContentV3Schema,
  templateFieldGroupSchema,
  templateFieldVisibilitySchema,
  templateLayoutSchema,
  textRunSchema,
  textFieldBlockObjectSchema,
  choiceGridFieldBlockSchema,
  tableFieldBlockSchema,
} from "@/types/template"
import { DOCUMENT_STYLES, type DocumentStyle } from "@/types/template-styles"
import type {
  TemplateFlowLedgerItem,
  TemplateFlowMessage,
  TemplateFlowOperationType,
  TemplateFlowQualityIssue,
} from "@/types/template-flow"
import { ServiceError } from "@/services/service-error"

// A sectioned intake form or agreement runs to dozens of operations.
export const FLOW_MAX_OUTPUT_TOKENS = 16_384

export const FLOW_MAX_OPERATIONS = 80

// Calls spent getting one valid draft. A valid draft with faults may then get one rewrite on top.
export const FLOW_MAX_UPSTREAM_CALLS = 2

// Past this a rewrite would risk the request's own time limit, so the first draft stands.
export const FLOW_REVISE_DEADLINE_MS = 100_000

// What a rewrite cannot settle: a decision only the author can make, a notice, and the record's own description.
export const FLOW_UNREVISABLE_ISSUE_CODES: ReadonlySet<string> = new Set([
  "unresolved_needs_input",
  "collects_health_information",
  "missing_description"
])

// Room for a whole response at the output limit, so a prior response is never handed back cut in half.
export const MAX_FLOW_REPAIR_RESPONSE_CHARACTERS = 64_000

export const MAX_FLOW_REPAIR_DETAIL_CHARACTERS = 300

export const MAX_FLOW_HISTORY_MESSAGES = 20

// A 50-page document runs to about 150,000; this reads one of about 130 pages whole.
export const MAX_FLOW_CONTEXT_CHARACTERS = 400_000

export const MAX_FLOW_STRUCTURE_CONTEXT_CHARACTERS = 40_000


const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/)

const generatedFieldKeySchema = z.string().trim().min(1).max(240)

const flowDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().max(2_000),
    content: templateContentSchema
  })
  .strict()

export const editableFlowDraftSchema = flowDraftSchema
  .extend({ content: templateContentV3Schema })
  .strict()

export const flowRequestSchema = z
  .object({
    actorUserId: z.string().trim().min(1),
    organizationId: z.string().trim().min(1),
    templateId: z.string().uuid(),
    draft: flowDraftSchema,
    instruction: z.string().trim().min(2).max(2_000),
    model: flowModelSchema.optional()
  })
  .strict()

const generatedRunSchema = textRunSchema.pick({ bold: true, italic: true, text: true, underline: true }).strict()

// A rule as Flow writes it; null takes a block's rule off.
const FLOW_VISIBLE_WHEN = { visibleWhen: templateFieldVisibilitySchema.nullable().optional() }

const generatedBlockSchema = z.discriminatedUnion("type", [
  // Flow may make words bold, italic or underlined; fonts, sizes and colours stay the editor's.
  headingBlockObjectSchema.omit({ id: true }).extend({ runs: z.array(generatedRunSchema).max(200).optional(), ...FLOW_VISIBLE_WHEN }).strict(),
  paragraphBlockObjectSchema.omit({ id: true }).extend({ runs: z.array(generatedRunSchema).max(200).optional(), ...FLOW_VISIBLE_WHEN }).strict(),
  bulletListBlockObjectSchema.omit({ id: true, itemRuns: true }).extend(FLOW_VISIBLE_WHEN),
  numberedListBlockObjectSchema.omit({ id: true, itemRuns: true }).extend(FLOW_VISIBLE_WHEN),
  tableBlockSchema.omit({ id: true }).extend(FLOW_VISIBLE_WHEN),
  dividerBlockSchema.omit({ id: true }),
  textFieldBlockObjectSchema
    .omit({ id: true, fieldKey: true })
    .extend({ fieldKey: generatedFieldKeySchema, ...FLOW_VISIBLE_WHEN })
    .strict(),
  dateFieldBlockSchema
    .omit({ id: true, fieldKey: true })
    .extend({ fieldKey: generatedFieldKeySchema, ...FLOW_VISIBLE_WHEN })
    .strict(),
  checkboxFieldBlockSchema
    .omit({ id: true, fieldKey: true })
    .extend({ fieldKey: generatedFieldKeySchema, ...FLOW_VISIBLE_WHEN })
    .strict(),
  dropdownFieldBlockSchema
    .omit({ id: true, fieldKey: true })
    // The question its "Other" answer asks; it names the field Flow adds for it.
    .extend({ fieldKey: generatedFieldKeySchema, otherLabel: z.string().trim().min(1).max(160).optional(), ...FLOW_VISIBLE_WHEN })
    .strict(),
  choiceGridFieldBlockSchema
    .omit({ id: true, fieldKey: true })
    .extend({ fieldKey: generatedFieldKeySchema, ...FLOW_VISIBLE_WHEN })
    .strict(),
  tableFieldBlockSchema
    .omit({ id: true, fieldKey: true })
    .extend({ fieldKey: generatedFieldKeySchema, ...FLOW_VISIBLE_WHEN })
    .strict(),
  initialsFieldBlockSchema
    .omit({ id: true, fieldKey: true })
    .extend({ fieldKey: generatedFieldKeySchema, ...FLOW_VISIBLE_WHEN })
    .strict(),
  signatureFieldBlockSchema
    .omit({ id: true, fieldKey: true })
    .extend({ fieldKey: generatedFieldKeySchema, ...FLOW_VISIBLE_WHEN })
    .strict(),
  fileFieldBlockSchema
    .omit({ id: true, fieldKey: true })
    .extend({ fieldKey: generatedFieldKeySchema, ...FLOW_VISIBLE_WHEN })
    .strict()
])

const operationSummarySchema = z.string().trim().min(1).max(180)

const flowWireOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("set_title"),
      summary: operationSummarySchema,
      payload: z.object({ value: z.string().trim().min(1).max(180) }).strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("set_description"),
      summary: operationSummarySchema,
      payload: z.object({ value: z.string().trim().max(2_000) }).strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("set_branding"),
      summary: operationSummarySchema,
      payload: z
        .object({
          organizationName: z.string().trim().max(160).optional(),
          primaryColor: hexColorSchema.optional(),
          accentColor: hexColorSchema.optional(),
          logoAlignment: z.enum(["left", "center", "right"]).optional(),
          logoWidthPercent: z.number().int().min(10).max(60).optional(),
          removeLogo: z.boolean().optional()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("add_block"),
      summary: operationSummarySchema,
      payload: z
        .object({
          afterBlockId: uuidSchema.nullable(),
          block: generatedBlockSchema,
          // The id a block's ref was given before this was read; never the model's own.
          id: uuidSchema.optional()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("update_block"),
      summary: operationSummarySchema,
      payload: z
        .object({
          blockId: uuidSchema,
          block: generatedBlockSchema
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("update_image"),
      summary: operationSummarySchema,
      payload: z
        .object({
          blockId: uuidSchema,
          altText: z.string().trim().min(1).max(500),
          caption: z.string().trim().max(500).nullable(),
          alignment: z.enum(["left", "center", "right"]),
          widthPercent: z.number().int().min(10).max(100)
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("move_block"),
      summary: operationSummarySchema,
      payload: z
        .object({
          blockId: uuidSchema,
          afterBlockId: uuidSchema.nullable()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("remove_block"),
      summary: operationSummarySchema,
      payload: z.object({ blockId: uuidSchema }).strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("set_section"),
      summary: operationSummarySchema,
      payload: z
        .object({
          blockId: uuidSchema,
          // Its printed title, or null to end the section that starts here.
          label: z.string().trim().min(1).max(160).nullable(),
          pageBreakBefore: z.boolean().optional(),
          keepTogether: z.boolean().optional()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("set_row"),
      summary: operationSummarySchema,
      payload: z
        .object({
          blockIds: z.array(uuidSchema).min(2).max(MAX_ROW_COLUMNS),
          // Twelfths of the page's width, one for each block.
          widths: z.array(z.number().int()).min(2).max(MAX_ROW_COLUMNS).optional(),
          // A small heading over the row, such as "Applicant"; null takes it away.
          label: templateFieldGroupSchema.shape.label.optional()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("set_layout"),
      summary: operationSummarySchema,
      payload: z
        .object({
          // A whole look at once; anything else given here is set after it.
          style: z.enum(Object.keys(DOCUMENT_STYLES) as [DocumentStyle, ...DocumentStyle[]]).optional(),
          pageSize: templateLayoutSchema.shape.pageSize.unwrap().optional(),
          orientation: templateLayoutSchema.shape.orientation.unwrap().optional(),
          marginPreset: templateLayoutSchema.shape.marginPreset.unwrap().optional(),
          lineSpacing: templateLayoutSchema.shape.lineSpacing,
          paragraphSpacing: templateLayoutSchema.shape.paragraphSpacing,
          fieldStyle: templateLayoutSchema.shape.fieldStyle,
          sectionStyle: templateLayoutSchema.shape.sectionStyle,
          // "none" takes numbering away, where absent leaves it as it is.
          sectionNumbers: z.enum(["letters", "numbers", "clauses", "none"]).optional(),
          headerText: templateLayoutSchema.shape.headerText,
          footerText: templateLayoutSchema.shape.footerText,
          headerPolicy: templateLayoutSchema.shape.headerPolicy.unwrap().optional(),
          footerPolicy: templateLayoutSchema.shape.footerPolicy.unwrap().optional(),
          pageNumbering: templateLayoutSchema.shape.pageNumbering.unwrap().optional()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("stand_alone"),
      summary: operationSummarySchema,
      payload: z.object({ blockId: uuidSchema }).strict()
    })
    .strict(),
  z
    .object({
      type: z.literal("set_block_rule"),
      summary: operationSummarySchema,
      payload: z
        .object({
          blockId: uuidSchema,
          pageBreakBefore: z.boolean().optional(),
          keepWithNext: z.boolean().optional(),
          // Any size is taken and held to what a page allows, as a drag in the editor is.
          spaceAbove: z.number().min(0).optional(),
          frame: z
            .object({ left: z.number().min(0).max(100), width: z.number().min(0).max(100) })
            .strict()
            .nullable()
            .optional()
        })
        .strict()
    })
    .strict()
])

// What every Flow response says around its operations.
const flowResponseEnvelopeShape = {
  assistantMessage: z.string().trim().min(1).max(2_000),
  needsConfirmation: z.boolean(),
  confirmationQuestion: z.string().trim().max(500)
}

export const flowProviderResponseSchema = z
  .object({
    ...flowResponseEnvelopeShape,
    operations: z.array(flowWireOperationSchema).max(FLOW_MAX_OPERATIONS)
  })
  .strict()

export const flowStructuredResponseSchema = z
  .object({
    ...flowResponseEnvelopeShape,
    operations: z
      .array(
        z
          .object({
            type: z.enum(TEMPLATE_FLOW_OPERATION_TYPES),
            summary: operationSummarySchema,
            payloadJson: z.string().trim().min(2).max(50_000)
          })
          .strict()
      )
      .max(FLOW_MAX_OPERATIONS)
  })
  .strict()

// A rebuild takes back only what a Flow response could have held.
export const flowRebuildRequestSchema = flowRequestSchema
  .omit({ instruction: true, model: true })
  .extend({
    baseDraftFingerprint: z.string().min(1).max(200),
    operations: flowProviderResponseSchema.shape.operations
  })
  .strict()

export type FlowProviderResponse = z.infer<typeof flowProviderResponseSchema>

export type FlowProviderResult = {
  model: AiModelReference
  response: FlowProviderResponse
  application: FlowApplicationResult | null
  confirmationQuestion: string | null
  qualityIssues: TemplateFlowQualityIssue[]
  traceId: string
  upstreamCalls: number
  usage: AiTokenUsage
}

export type FlowProviderParseResult =
  | {
      success: true
      data: FlowProviderResponse
    }
  | {
      success: false
      issueCode: string
      issuePath: string
      /** What went wrong, for the model's correction; it can quote a label, so it is never logged. */
      detail?: string
    }

export type FlowWireOperation = z.infer<typeof flowWireOperationSchema>

export type GeneratedBlock = z.infer<typeof generatedBlockSchema>

type ParsedFlowRequest = z.infer<typeof flowRequestSchema>

export type EditableFlowDraft = z.infer<typeof editableFlowDraftSchema>

export type EditableFlowRequest = Omit<ParsedFlowRequest, "draft"> & {
  draft: EditableFlowDraft
}

/** What a Flow change is made to, and for whom. */
export type FlowSubject = Omit<EditableFlowRequest, "instruction">

export type FlowOperationPayload<T extends TemplateFlowOperationType> = Extract<
  FlowWireOperation,
  { type: T }
>["payload"]

export type FlowApplicationResult = {
  draft: EditableFlowDraft
  ledgerItems: TemplateFlowLedgerItem[]
  changedBlockIds: string[]
}

export type TemplateFlowProposalReceipt = {
  proposalId: string
  status: "proposed"
  baseDraftFingerprint: string
}

export type FlowCandidateValidationResult =
  | {
      success: true
      application: FlowApplicationResult | null
      confirmationQuestion: string | null
      qualityIssues: TemplateFlowQualityIssue[]
    }
  | {
      success: false
      issueCode: string
      issuePath: string
      detail?: string
    }

export type TemplateFlowClient = Pick<AdminSupabaseClient, "from" | "rpc">

export type ExecuteTemplateFlowInput = {
  actorUserId: string
  organizationId: string
  templateId: unknown
  draft: unknown
  instruction: unknown
  model?: unknown
}

export type ExecuteDocumentFlowInput = {
  actorUserId: string
  organizationId: string
  documentId: string
  draft: unknown
  instruction: unknown
  model?: unknown
}

export type RebuildTemplateFlowProposalInput = Omit<ExecuteTemplateFlowInput, "instruction" | "model"> & {
  baseDraftFingerprint: unknown
  operations: unknown
}

export type RebuildDocumentFlowProposalInput = Omit<RebuildTemplateFlowProposalInput, "templateId"> & {
  documentId: string
}

export type DocumentFlowServiceDeps = TemplateFlowServiceDeps & {
  authorizeDocument?: (input: {
    actorUserId: string
    organizationId: string
    documentId: string
  }) => Promise<void>
}

export type ListTemplateFlowMessagesInput = {
  actorUserId: string
  organizationId: string
  templateId: string
}

export type TemplateFlowServiceDeps = {
  authorizeTemplateManagement?: (input: {
    actorUserId: string
    organizationId: string
    templateId: string
  }) => Promise<void>
  client?: TemplateFlowClient
  createId?: () => string
  createTraceId?: () => string
  getAiRuntime?: (options?: { model?: string }) => AiRuntime
  loadHistory?: (input: {
    organizationId: string
    templateId: string
  }) => Promise<TemplateFlowMessage[]>
  now?: () => Date
  persistMessages?: (input: {
    messages: [TemplateFlowMessage, TemplateFlowMessage]
    proposalReceipt: TemplateFlowProposalReceipt | null
    organizationId: string
    templateId: string
    actorUserId: string
  }) => Promise<void>
  resolveAuthorName?: (actorUserId: string) => Promise<string>
}

/** Error raised when Flow cannot safely complete a template conversation turn. */
export class TemplateFlowServiceError extends ServiceError {
  override readonly name = "TemplateFlowServiceError"
}
