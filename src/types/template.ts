import { z } from "zod"

import type { DocumentLifecycleState } from "@/types/document"

/** Maximum encoded length accepted for an embedded PNG or JPEG image. */
export const MAX_IMAGE_DATA_URL_LENGTH = 2_800_000

/** Maximum serialized size accepted for one complete guided document layout. */
export const MAX_TEMPLATE_CONTENT_JSON_LENGTH = 8_000_000

/** Maximum number of ordered blocks accepted in one canonical document. */
export const MAX_TEMPLATE_BLOCK_COUNT = 250

/** Canonical data URI pattern accepted for embedded PNG and JPEG images. */
export const IMAGE_DATA_URL_PATTERN =
  /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/
const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/

const blockIdSchema = z.string().uuid()
const shortTextSchema = z.string().trim().max(240)
const richTextSchema = z.string().trim().max(20_000)
const fieldKeySchema = z.string().trim().regex(FIELD_KEY_PATTERN)
const imageDataUrlSchema = z
  .string()
  .max(MAX_IMAGE_DATA_URL_LENGTH)
  .regex(IMAGE_DATA_URL_PATTERN)

/** Conditional display rule supported by version-three fillable fields. */
export const templateFieldVisibilitySchema = z
  .object({
    sourceBlockId: blockIdSchema,
    operator: z.literal("equals"),
    value: z.union([z.boolean(), z.string().trim().max(240)])
  })
  .strict()

const fieldBlockShape = {
  id: blockIdSchema,
  fieldKey: fieldKeySchema,
  label: z.string().trim().min(1).max(160),
  required: z.boolean().default(false),
  helpText: z.string().trim().max(500).nullable().default(null),
  visibleWhen: templateFieldVisibilitySchema.optional()
} as const

/** Heading block in the ordered document flow. */
export const headingBlockSchema = z
  .object({
    id: blockIdSchema,
    type: z.literal("heading"),
    text: z.string().trim().min(1).max(500),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
    alignment: z.enum(["left", "center", "right"]).default("left")
  })
  .strict()

/** Paragraph block in the ordered document flow. */
export const paragraphBlockSchema = z
  .object({
    id: blockIdSchema,
    type: z.literal("paragraph"),
    text: richTextSchema,
    alignment: z.enum(["left", "center", "right"]).default("left")
  })
  .strict()

/** Bulleted list block in the ordered document flow. */
export const bulletListBlockSchema = z
  .object({
    id: blockIdSchema,
    type: z.literal("bullet_list"),
    items: z.array(z.string().trim().min(1).max(2_000)).min(1).max(100)
  })
  .strict()

/** Numbered list block in the ordered document flow. */
export const numberedListBlockSchema = z
  .object({
    id: blockIdSchema,
    type: z.literal("numbered_list"),
    items: z.array(z.string().trim().min(1).max(2_000)).min(1).max(100)
  })
  .strict()

/** Embedded PNG or JPEG image block. */
export const imageBlockSchema = z
  .object({
    id: blockIdSchema,
    type: z.literal("image"),
    dataUrl: imageDataUrlSchema,
    altText: z.string().trim().min(1).max(500),
    caption: z.string().trim().max(500).nullable().default(null),
    alignment: z.enum(["left", "center", "right"]).default("center"),
    widthPercent: z.number().int().min(10).max(100).default(100)
  })
  .strict()

/** Simple printable table block. */
export const tableBlockSchema = z
  .object({
    id: blockIdSchema,
    type: z.literal("table"),
    headers: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
    rows: z.array(z.array(z.string().trim().max(2_000)).min(1).max(12)).max(100)
  })
  .strict()

/** Horizontal divider block. */
export const dividerBlockSchema = z
  .object({
    id: blockIdSchema,
    type: z.literal("divider")
  })
  .strict()

/** Single-line or multiline text input block. */
export const textFieldBlockSchema = z
  .object({
    ...fieldBlockShape,
    type: z.literal("text_field"),
    placeholder: shortTextSchema.nullable().default(null),
    multiline: z.boolean().default(false)
  })
  .strict()

/** Date input block. */
export const dateFieldBlockSchema = z
  .object({
    ...fieldBlockShape,
    type: z.literal("date_field")
  })
  .strict()

/** Boolean acknowledgement input block. */
export const checkboxFieldBlockSchema = z
  .object({
    ...fieldBlockShape,
    type: z.literal("checkbox_field"),
    checkedByDefault: z.boolean().default(false)
  })
  .strict()

/** Select input block with a bounded set of choices. */
export const dropdownFieldBlockSchema = z
  .object({
    ...fieldBlockShape,
    type: z.literal("dropdown_field"),
    placeholder: shortTextSchema.nullable().default(null),
    options: z.array(z.string().trim().min(1).max(240)).max(100)
  })
  .strict()

/** Drawn initials input block. */
export const initialsFieldBlockSchema = z
  .object({
    ...fieldBlockShape,
    type: z.literal("initials_field")
  })
  .strict()

/** Drawn signature input block for the MVP acknowledgement workflow. */
export const signatureFieldBlockSchema = z
  .object({
    ...fieldBlockShape,
    type: z.literal("signature_field")
  })
  .strict()

/** Single-file upload block reserved for internal submission workflows. */
export const fileFieldBlockSchema = z
  .object({
    ...fieldBlockShape,
    type: z.literal("file_field")
  })
  .strict()

/** Canonical union of every supported guided document block. */
export const templateBlockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  paragraphBlockSchema,
  bulletListBlockSchema,
  numberedListBlockSchema,
  imageBlockSchema,
  tableBlockSchema,
  dividerBlockSchema,
  textFieldBlockSchema,
  dateFieldBlockSchema,
  checkboxFieldBlockSchema,
  dropdownFieldBlockSchema,
  initialsFieldBlockSchema,
  signatureFieldBlockSchema,
  fileFieldBlockSchema
])

/** Organization-controlled visual choices stored with each document snapshot. */
export const templateBrandingSchema = z
  .object({
    organizationName: z.string().trim().max(160).default(""),
    logoDataUrl: imageDataUrlSchema.nullable().default(null),
    logoAlignment: z.enum(["left", "center", "right"]).default("left"),
    logoWidthPercent: z.number().int().min(10).max(60).default(24),
    primaryColor: z.string().regex(HEX_COLOR_PATTERN).default("#252329"),
    accentColor: z.string().regex(HEX_COLOR_PATTERN).default("#635273")
  })
  .strict()

const templateBlocksSchema = z
  .array(templateBlockSchema)
  .max(MAX_TEMPLATE_BLOCK_COUNT, {
    error: `Template content cannot contain more than ${MAX_TEMPLATE_BLOCK_COUNT} blocks.`
  })
  .default([])

const templateBrandingDefault = {
  organizationName: "",
  logoDataUrl: null,
  logoAlignment: "left",
  logoWidthPercent: 24,
  primaryColor: "#252329",
  accentColor: "#635273"
} as const

/** Page and repeated-element controls captured in version-three snapshots. */
export const templateLayoutSchema = z
  .object({
    pageSize: z.enum(["A3", "A4", "A5", "Letter", "Legal"]).default("A4"),
    orientation: z.enum(["portrait", "landscape"]).default("portrait"),
    marginPreset: z
      .enum(["standard", "compact", "generous"])
      .default("standard"),
    density: z
      .enum(["balanced", "compact", "comfortable"])
      .default("balanced"),
    printedTitle: z
      .discriminatedUnion("mode", [
        z.object({ mode: z.literal("linked") }).strict(),
        z
          .object({
            mode: z.literal("custom"),
            text: z.string().trim().min(1).max(500)
          })
          .strict()
      ])
      .default({ mode: "linked" }),
    headerPolicy: z
      .enum(["first_page", "all_pages", "none"])
      .default("first_page"),
    footerPolicy: z
      .enum(["first_page", "all_pages", "none"])
      .default("all_pages"),
    pageNumbering: z.enum(["none", "page_x_of_y"]).default("page_x_of_y")
  })
  .strict()

/** One section boundary in the canonical root block order. */
export const templateSectionSchema = z
  .object({
    id: blockIdSchema,
    label: z.string().trim().min(1).max(160),
    startBlockId: blockIdSchema,
    pageBreakBefore: z.boolean(),
    keepTogether: z.boolean()
  })
  .strict()

/** One contiguous field range rendered in one or two columns. */
export const templateFieldGroupSchema = z
  .object({
    id: blockIdSchema,
    label: z.string().trim().min(1).max(160).nullable().default(null),
    startBlockId: blockIdSchema,
    endBlockId: blockIdSchema,
    columns: z.union([z.literal(1), z.literal(2)]),
    keepTogether: z.boolean()
  })
  .strict()

/** Pagination hints attached to one canonical block reference. */
export const templateBlockRuleSchema = z
  .object({
    blockId: blockIdSchema,
    pageBreakBefore: z.boolean(),
    keepWithNext: z.boolean()
  })
  .strict()
  .refine(
    (rule): boolean => rule.pageBreakBefore || rule.keepWithNext,
    "A block rule must enable at least one pagination behavior."
  )

/** Read-compatible version-two template content retained for immutable snapshots. */
export const templateContentV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    branding: templateBrandingSchema.default(templateBrandingDefault),
    blocks: templateBlocksSchema
  })
  .strict()
  .superRefine((content, context): void => {
    validateCanonicalBlocks(content, context)

    for (const [blockIndex, block] of content.blocks.entries()) {
      if ("visibleWhen" in block && block.visibleWhen !== undefined) {
        context.addIssue({
          code: "custom",
          message:
            "Conditional field visibility requires template schema version three.",
          path: ["blocks", blockIndex, "visibleWhen"]
        })
      }
    }
  })

/** Editable version-three template content with layout and structure metadata. */
export const templateContentV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    branding: templateBrandingSchema.default(templateBrandingDefault),
    blocks: templateBlocksSchema,
    layout: templateLayoutSchema.default({
      pageSize: "A4",
      orientation: "portrait",
      marginPreset: "standard",
      density: "balanced",
      printedTitle: { mode: "linked" },
      headerPolicy: "first_page",
      footerPolicy: "all_pages",
      pageNumbering: "page_x_of_y"
    }),
    sections: z.array(templateSectionSchema).max(MAX_TEMPLATE_BLOCK_COUNT),
    fieldGroups: z.array(templateFieldGroupSchema).max(MAX_TEMPLATE_BLOCK_COUNT),
    blockRules: z.array(templateBlockRuleSchema).max(MAX_TEMPLATE_BLOCK_COUNT)
  })
  .strict()
  .superRefine((content, context): void => {
    validateCanonicalBlocks(content, context)
    validateVersionThreeStructure(content, context)
  })

/** Canonical dual-read schema for editable content and immutable snapshots. */
export const templateContentSchema = z.union([
  templateContentV2Schema,
  templateContentV3Schema
])

export type HeadingBlock = z.infer<typeof headingBlockSchema>
export type ParagraphBlock = z.infer<typeof paragraphBlockSchema>
export type BulletListBlock = z.infer<typeof bulletListBlockSchema>
export type NumberedListBlock = z.infer<typeof numberedListBlockSchema>
export type ImageBlock = z.infer<typeof imageBlockSchema>
export type TableBlock = z.infer<typeof tableBlockSchema>
export type DividerBlock = z.infer<typeof dividerBlockSchema>
export type TextFieldBlock = z.infer<typeof textFieldBlockSchema>
export type DateFieldBlock = z.infer<typeof dateFieldBlockSchema>
export type CheckboxFieldBlock = z.infer<typeof checkboxFieldBlockSchema>
export type DropdownFieldBlock = z.infer<typeof dropdownFieldBlockSchema>
export type InitialsFieldBlock = z.infer<typeof initialsFieldBlockSchema>
export type SignatureFieldBlock = z.infer<typeof signatureFieldBlockSchema>
export type FileFieldBlock = z.infer<typeof fileFieldBlockSchema>
export type TemplateBlock = z.infer<typeof templateBlockSchema>
export type TemplateBranding = z.infer<typeof templateBrandingSchema>
export type TemplateLayout = z.infer<typeof templateLayoutSchema>
export type TemplateSection = z.infer<typeof templateSectionSchema>
export type TemplateFieldGroup = z.infer<typeof templateFieldGroupSchema>
export type TemplateBlockRule = z.infer<typeof templateBlockRuleSchema>
export type TemplateContentV2 = z.infer<typeof templateContentV2Schema>
export type TemplateContentV3 = z.infer<typeof templateContentV3Schema>
export type TemplateContent = z.infer<typeof templateContentSchema>

function validateCanonicalBlocks(
  content: { blocks: readonly TemplateBlock[] },
  context: z.RefinementCtx
): void {
  if (JSON.stringify(content).length > MAX_TEMPLATE_CONTENT_JSON_LENGTH) {
    context.addIssue({
      code: "custom",
      message: "Template content is too large."
    })
  }

  const blockIds = new Set<string>()
  const fieldKeys = new Set<string>()

  for (const [blockIndex, block] of content.blocks.entries()) {
    const blockPath = ["blocks", blockIndex]

    if (blockIds.has(block.id)) {
      context.addIssue({
        code: "custom",
        message: "Every document block must have a unique id.",
        path: [...blockPath, "id"]
      })
    }
    blockIds.add(block.id)

    if ("fieldKey" in block) {
      const normalizedFieldKey = block.fieldKey.toLowerCase()

      if (fieldKeys.has(normalizedFieldKey)) {
        context.addIssue({
          code: "custom",
          message: "Every fillable field must have a unique field key.",
          path: [...blockPath, "fieldKey"]
        })
      }
      fieldKeys.add(normalizedFieldKey)
    }
  }
}

function validateVersionThreeStructure(
  content: TemplateContentV3,
  context: z.RefinementCtx
): void {
  const blockIndexById = new Map(
    content.blocks.map(
      (block: TemplateBlock, index: number): readonly [string, number] => [
        block.id,
        index
      ]
    )
  )
  const sectionStartIndices = validateSections(
    content,
    blockIndexById,
    context
  )

  validateFieldGroups(content, blockIndexById, sectionStartIndices, context)
  validateBlockRules(content, blockIndexById, context)
  validateFieldVisibility(content, blockIndexById, context)
}

function validateSections(
  content: TemplateContentV3,
  blockIndexById: ReadonlyMap<string, number>,
  context: z.RefinementCtx
): number[] {
  if (content.blocks.length === 0) {
    if (content.sections.length > 0) {
      context.addIssue({
        code: "custom",
        message: "An empty document cannot contain section boundaries.",
        path: ["sections"]
      })
    }

    return []
  }

  // Sections are optional structure metadata: content authored before the
  // version-three editor maintains them stays readable, and a document with no
  // declared boundaries is simply treated as one implicit section.
  if (content.sections.length === 0) {
    return []
  }

  const firstBlockId = content.blocks[0]?.id

  if (content.sections[0]?.startBlockId !== firstBlockId) {
    context.addIssue({
      code: "custom",
      message: "The first section must start at the first document block.",
      path: ["sections", 0, "startBlockId"]
    })
  }

  const sectionStartIndices: number[] = []
  const sectionIds = new Set<string>()
  let priorIndex = -1

  for (const [sectionIndex, section] of content.sections.entries()) {
    const blockIndex = blockIndexById.get(section.startBlockId)

    if (sectionIds.has(section.id)) {
      context.addIssue({
        code: "custom",
        message: "Every section must have a unique stable id.",
        path: ["sections", sectionIndex, "id"]
      })
    }
    sectionIds.add(section.id)

    if (blockIndex === undefined) {
      context.addIssue({
        code: "custom",
        message: "Every section must reference an existing document block.",
        path: ["sections", sectionIndex, "startBlockId"]
      })
      continue
    }

    if (blockIndex <= priorIndex) {
      context.addIssue({
        code: "custom",
        message: "Section boundaries must follow canonical block order.",
        path: ["sections", sectionIndex, "startBlockId"]
      })
    }

    sectionStartIndices.push(blockIndex)
    priorIndex = blockIndex
  }

  return sectionStartIndices
}

function validateFieldGroups(
  content: TemplateContentV3,
  blockIndexById: ReadonlyMap<string, number>,
  sectionStartIndices: readonly number[],
  context: z.RefinementCtx
): void {
  const groupIds = new Set<string>()
  let priorEndIndex = -1

  for (const [groupIndex, group] of content.fieldGroups.entries()) {
    const startIndex = blockIndexById.get(group.startBlockId)
    const endIndex = blockIndexById.get(group.endBlockId)

    if (groupIds.has(group.id)) {
      context.addIssue({
        code: "custom",
        message: "Every field group must have a unique stable id.",
        path: ["fieldGroups", groupIndex, "id"]
      })
    }
    groupIds.add(group.id)

    if (startIndex === undefined || endIndex === undefined) {
      context.addIssue({
        code: "custom",
        message: "Every field group range must reference existing blocks.",
        path: ["fieldGroups", groupIndex]
      })
      continue
    }

    if (startIndex > endIndex) {
      context.addIssue({
        code: "custom",
        message: "A field group must follow canonical block order.",
        path: ["fieldGroups", groupIndex]
      })
      continue
    }

    if (startIndex <= priorEndIndex) {
      context.addIssue({
        code: "custom",
        message: "Field groups must be ordered and cannot overlap.",
        path: ["fieldGroups", groupIndex]
      })
    }
    priorEndIndex = Math.max(priorEndIndex, endIndex)

    const startSectionIndex = findSectionIndex(
      sectionStartIndices,
      startIndex
    )
    const endSectionIndex = findSectionIndex(sectionStartIndices, endIndex)

    // With no declared sections the document is one implicit section, so no
    // group can cross a boundary that does not exist.
    if (
      sectionStartIndices.length > 0 &&
      (startSectionIndex === -1 ||
        endSectionIndex === -1 ||
        startSectionIndex !== endSectionIndex)
    ) {
      context.addIssue({
        code: "custom",
        message: "A field group cannot cross a section boundary.",
        path: ["fieldGroups", groupIndex]
      })
    }

    const groupedBlocks = content.blocks.slice(startIndex, endIndex + 1)

    if (groupedBlocks.some((block: TemplateBlock): boolean => !isFieldBlock(block))) {
      context.addIssue({
        code: "custom",
        message: "A field group range can contain only fillable fields.",
        path: ["fieldGroups", groupIndex]
      })
    }
  }
}

function validateBlockRules(
  content: TemplateContentV3,
  blockIndexById: ReadonlyMap<string, number>,
  context: z.RefinementCtx
): void {
  const referencedBlockIds = new Set<string>()

  for (const [ruleIndex, rule] of content.blockRules.entries()) {
    if (!blockIndexById.has(rule.blockId)) {
      context.addIssue({
        code: "custom",
        message: "Every block rule must reference an existing block.",
        path: ["blockRules", ruleIndex, "blockId"]
      })
    }

    if (referencedBlockIds.has(rule.blockId)) {
      context.addIssue({
        code: "custom",
        message: "A block can have only one pagination rule.",
        path: ["blockRules", ruleIndex, "blockId"]
      })
    }
    referencedBlockIds.add(rule.blockId)
  }
}

function validateFieldVisibility(
  content: TemplateContentV3,
  blockIndexById: ReadonlyMap<string, number>,
  context: z.RefinementCtx
): void {
  const conditionSources = new Map<string, string>()

  for (const [targetIndex, targetBlock] of content.blocks.entries()) {
    if (!isFieldBlock(targetBlock) || targetBlock.visibleWhen === undefined) {
      continue
    }

    const condition = targetBlock.visibleWhen
    const conditionPath = ["blocks", targetIndex, "visibleWhen"]
    const sourceIndex = blockIndexById.get(condition.sourceBlockId)
    const sourceBlock =
      sourceIndex === undefined ? undefined : content.blocks[sourceIndex]

    conditionSources.set(targetBlock.id, condition.sourceBlockId)

    if (condition.sourceBlockId === targetBlock.id) {
      context.addIssue({
        code: "custom",
        message: "A field cannot control its own visibility.",
        path: [...conditionPath, "sourceBlockId"]
      })
      continue
    }

    if (sourceIndex === undefined || sourceBlock === undefined) {
      context.addIssue({
        code: "custom",
        message: "A visibility condition must reference an existing field.",
        path: [...conditionPath, "sourceBlockId"]
      })
      continue
    }

    if (sourceIndex >= targetIndex) {
      context.addIssue({
        code: "custom",
        message: "A visibility source must appear before the conditional field.",
        path: [...conditionPath, "sourceBlockId"]
      })
    }

    if (sourceBlock.type === "checkbox_field") {
      if (typeof condition.value !== "boolean") {
        context.addIssue({
          code: "custom",
          message: "A checkbox visibility condition must compare a boolean.",
          path: [...conditionPath, "value"]
        })
      }
      continue
    }

    if (sourceBlock.type === "dropdown_field") {
      if (
        typeof condition.value !== "string" ||
        !sourceBlock.options.includes(condition.value)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "A dropdown visibility condition must compare a declared option.",
          path: [...conditionPath, "value"]
        })
      }
      continue
    }

    context.addIssue({
      code: "custom",
      message:
        "Only an earlier checkbox or dropdown can control field visibility.",
      path: [...conditionPath, "sourceBlockId"]
    })
  }

  for (const [targetBlockId, sourceBlockId] of conditionSources.entries()) {
    const visited = new Set<string>([targetBlockId])
    let cursor: string | undefined = sourceBlockId

    while (cursor !== undefined) {
      if (visited.has(cursor)) {
        const targetIndex = blockIndexById.get(targetBlockId)

        context.addIssue({
          code: "custom",
          message: "Field visibility conditions cannot form cycles.",
          path:
            targetIndex === undefined
              ? ["blocks"]
              : ["blocks", targetIndex, "visibleWhen", "sourceBlockId"]
        })
        break
      }

      visited.add(cursor)
      cursor = conditionSources.get(cursor)
    }
  }
}

function findSectionIndex(
  sectionStartIndices: readonly number[],
  blockIndex: number
): number {
  let result = -1

  for (const [sectionIndex, startIndex] of sectionStartIndices.entries()) {
    if (startIndex > blockIndex) {
      break
    }
    result = sectionIndex
  }

  return result
}

function isFieldBlock(
  block: TemplateBlock
): block is Extract<TemplateBlock, { fieldKey: string }> {
  return "fieldKey" in block
}

export type DocumentTemplateStatus = "draft" | "published" | "archived"
export type DocumentSourceKind = "upload" | "generated"
export type GeneratedDocumentWorkflowStatus =
  "draft" | "awaiting_signatures" | "completed"
export type DocumentSigningRecipientStatus = "pending" | "viewed" | "signed"

/** Database row for an organization-owned reusable document template. */
export type DocumentTemplateRow = Record<string, unknown> & {
  id: string
  org_id: string
  title: string
  description: string | null
  status: DocumentTemplateStatus
  revision: number
  content: TemplateContent
  created_by: string | null
  updated_by: string | null
  published_by: string | null
  archived_by: string | null
  created_at: string
  updated_at: string
  published_at: string | null
  archived_at: string | null
}

/** Application-facing reusable document template. */
export type DocumentTemplate = {
  id: string
  organizationId: string
  title: string
  description: string | null
  status: DocumentTemplateStatus
  revision: number
  content: TemplateContent
  createdBy: string | null
  updatedBy: string | null
  publishedBy: string | null
  archivedBy: string | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  archivedAt: string | null
}

/** Database row containing field answers for one generated document. */
export type DocumentAnswerRow = Record<string, unknown> & {
  document_id: string
  org_id: string
  values: Record<string, unknown>
  workflow_status: GeneratedDocumentWorkflowStatus
  created_at: string
  updated_at: string
}

/** Database row for one internal or external document recipient. */
export type DocumentSigningRecipientRow = Record<string, unknown> & {
  id: string
  org_id: string
  document_id: string
  user_id: string | null
  name: string
  email: string
  requires_signature: boolean
  status: DocumentSigningRecipientStatus
  token_hash: string
  token_expires_at: string
  invited_at: string
  viewed_at: string | null
  signed_at: string | null
  signature_data: Record<string, unknown> | null
  initials_data: Record<string, unknown> | null
}

/** Database row tracking the last time a member opened a tenant document. */
export type DocumentRecentAccessRow = Record<string, unknown> & {
  org_id: string
  user_id: string
  document_id: string
  last_opened_at: string
}

/** Recent document data returned to the Documents workspace. */
export type RecentDocument = {
  organizationId: string
  userId: string
  documentId: string
  lastOpenedAt: string
  title: string
  description: string | null
  folderId: string | null
  sourceKind: DocumentSourceKind
}

/** Generated document metadata with its immutable guided-content snapshot. */
export type GeneratedDocument = {
  id: string
  organizationId: string
  folderId: string | null
  title: string
  description: string | null
  sourceKind: "generated"
  templateId: string | null
  templateRevision: number | null
  templateSnapshot: TemplateContent
  lifecycleState: DocumentLifecycleState
  createdBy: string | null
  updatedBy: string | null
  archivedAt: string | null
  trashedAt: string | null
  purgeAfter: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Parses version-two snapshots or version-three editable template content.
 *
 * Parsing is deliberately read-only with respect to schema versions: a version-two
 * snapshot remains version two until an editable boundary explicitly upgrades it.
 *
 * @param value - Untrusted content received from an editor, AI proposal, or database.
 * @returns Cloned canonical content with its persisted schema version preserved.
 * @throws z.ZodError when the content or any block is invalid.
 */
export function parseTemplateContent(value: unknown): TemplateContent {
  return templateContentSchema.parse(value)
}

/**
 * Upgrades legacy editable content to the version-three structure contract.
 *
 * The operation is idempotent and must be called only when content enters an
 * editable-template boundary. Immutable generated-document and submission
 * snapshots should continue to use `parseTemplateContent`.
 *
 * @param content - Already parsed version-two or version-three content.
 * @returns Version-three content with current layout and structure defaults.
 * @throws z.ZodError when the upgraded structure is invalid.
 */
export function upgradeV2TemplateContentToV3(
  content: TemplateContent
): TemplateContentV3 {
  if (content.schemaVersion === 3) {
    return content
  }

  return templateContentV3Schema.parse({
    schemaVersion: 3,
    branding: content.branding,
    blocks: content.blocks,
    sections:
      content.blocks.length === 0
        ? []
        : [
            {
              id: content.blocks[0]?.id,
              label: "Section 1",
              startBlockId: content.blocks[0]?.id,
              pageBreakBefore: false,
              keepTogether: false
            }
          ],
    fieldGroups: [],
    blockRules: []
  })
}

/**
 * Creates an empty, schema-valid free-form guided document.
 *
 * @returns Fresh version-three content with current A4 portrait defaults.
 */
export function createBlankTemplateContent(): TemplateContentV3 {
  return templateContentV3Schema.parse({
    schemaVersion: 3,
    blocks: [],
    sections: [],
    fieldGroups: [],
    blockRules: []
  })
}
