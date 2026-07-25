import { z } from "zod"

/** Maximum encoded length accepted for an embedded PNG or JPEG image. */
export const MAX_IMAGE_DATA_URL_LENGTH = 2_800_000

/** Maximum serialized size accepted for one complete guided document layout. */
export const MAX_TEMPLATE_CONTENT_JSON_LENGTH = 8_000_000

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

const fieldBlockShape = {
  id: blockIdSchema,
  fieldKey: fieldKeySchema,
  label: z.string().trim().min(1).max(160),
  required: z.boolean().default(false),
  helpText: z.string().trim().max(500).nullable().default(null)
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
    options: z.array(z.string().trim().min(1).max(240)).min(1).max(100)
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

/** Canonical free-form template and generated-document content schema. */
export const templateContentSchema = z
  .object({
    schemaVersion: z.literal(2),
    branding: templateBrandingSchema.default({
      organizationName: "",
      logoDataUrl: null,
      logoAlignment: "left",
      logoWidthPercent: 24,
      primaryColor: "#252329",
      accentColor: "#635273"
    }),
    blocks: z.array(templateBlockSchema).max(750).default([])
  })
  .strict()
  .superRefine((content, context): void => {
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
  })

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
export type TemplateContent = z.infer<typeof templateContentSchema>

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
  createdBy: string | null
  updatedBy: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Parses and normalizes unknown version-one template content.
 *
 * @param value - Untrusted content received from an editor, AI proposal, or database.
 * @returns A cloned canonical content value with schema defaults applied.
 * @throws z.ZodError when the content or any block is invalid.
 */
export function parseTemplateContent(value: unknown): TemplateContent {
  return templateContentSchema.parse(value)
}

/**
 * Creates an empty, schema-valid free-form guided document.
 *
 * @returns Fresh version-two content with one ordered block sequence.
 */
export function createBlankTemplateContent(): TemplateContent {
  return templateContentSchema.parse({
    schemaVersion: 2,
    blocks: []
  })
}
