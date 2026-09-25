import { randomUUID } from "node:crypto"

import { ZodError } from "zod"

import {
  EMBEDDED_PNG_TOO_LARGE_MESSAGE,
  exceedsEmbeddedImageLimit,
  MAX_DOCUMENT_PNG_PIXELS,
  parseImageDataUrl,
  readImageDimensions,
} from "@/lib/image-header"
import { captureUnexpectedError } from "@/lib/observability"
import {
  canPerformOrganizationAction,
  createOrganizationPermissionSubject,
  isOrganizationRole,
  type OrganizationPermissionAction,
  type OrganizationPermissionSubject,
} from "@/lib/permissions"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  mapGeneratedDocumentRow,
  type GeneratedDocumentRow,
} from "@/services/generated-documents/generated-document-persistence"
import {
  CONCURRENT_CHANGE_MESSAGE,
  isSerializationFailure,
} from "@/services/serialization-retry"
import type {
  DocumentSourceKind,
  DocumentTemplate,
  DocumentTemplateRow,
  DocumentTemplateStatus,
  DocumentTemplateSummary,
  DocumentTemplateSummaryRow,
  GeneratedDocument,
  TemplateBlock,
  TemplateContent,
  TemplateImageAsset,
} from "@/types/template"
import {
  parseTemplateContent,
  TEMPLATE_CATEGORY_MAX_LENGTH,
} from "@/types/template"

import type {
  TemplateServiceClient,
  TemplateServiceDeps,
} from "./contracts"
import { TemplateServiceError } from "./errors"
import { loadActiveMembership } from "@/services/organizations/active-membership"
import { mapImageAssets, PRINT_MAX_WIDTH } from "@/types/template-images"

export const TEMPLATE_COLUMNS =
  "id,org_id,title,description,category,status,revision,content,created_by,updated_by,published_by,archived_by,created_at,updated_at,published_at,archived_at"

/** Columns the templates list reads; template content stays behind. */
export const TEMPLATE_SUMMARY_COLUMNS =
  "id,org_id,title,category,status,revision,created_at,updated_at"

type LogValue = string | number | boolean | null | undefined

type MembershipRow = {
  role: string
  role_definition?: { permissions: string[] | null } | null
}

type FolderStateRow = {
  id: string
}

type SupabaseErrorLike = {
  code?: string
  details?: string
  hint?: string
  message?: string
}

export async function requirePermission(
  client: TemplateServiceClient,
  organizationId: string,
  actorUserId: string,
  action: OrganizationPermissionAction,
  rejectionMessage: string
): Promise<OrganizationPermissionSubject> {
  const { data, error } = await loadActiveMembership(client, organizationId, actorUserId)

  if (error) {
    throw createDatabaseError(error, "Unable to load document permissions.")
  }

  if (!data) {
    throw new TemplateServiceError(rejectionMessage, 403)
  }

  const row = data as MembershipRow
  const role = row.role

  if (!isOrganizationRole(role)) {
    throw new TemplateServiceError(
      "Database returned an unsupported organization role.",
      500
    )
  }

  const subject = createOrganizationPermissionSubject(
    role,
    row.role_definition?.permissions
  )

  if (!subject) {
    throw new TemplateServiceError(
      "Database returned unsupported role permissions.",
      500
    )
  }

  if (!canPerformOrganizationAction(subject, action)) {
    throw new TemplateServiceError(rejectionMessage, 403)
  }

  return subject
}

export async function getTemplateById(
  client: TemplateServiceClient,
  organizationId: string,
  templateId: string
): Promise<DocumentTemplate> {
  const { data, error } = await client
    .from("document_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("id", templateId)
    .eq("org_id", organizationId)
    .maybeSingle()

  if (error) {
    throw createDatabaseError(error, "Unable to load document template.")
  }

  if (!data) {
    throw new TemplateServiceError("Document template was not found.", 404)
  }

  return mapDocumentTemplate(data as DocumentTemplateRow)
}

export async function requireActiveFolder(
  client: TemplateServiceClient,
  organizationId: string,
  folderId: string
): Promise<void> {
  const { data, error } = await client
    .from("folders")
    .select("id")
    .eq("id", folderId)
    .eq("org_id", organizationId)
    .eq("lifecycle_state", "active")
    .maybeSingle()

  if (error) {
    throw createDatabaseError(error, "Unable to load document folder.")
  }

  if (!(data as FolderStateRow | null)) {
    throw new TemplateServiceError("Document folder was not found.", 404)
  }
}

export async function requireTenantDocument(
  client: TemplateServiceClient,
  organizationId: string,
  documentId: string
): Promise<void> {
  const { data, error } = await client
    .from("documents")
    .select("id")
    .eq("id", documentId)
    .eq("org_id", organizationId)
    .eq("lifecycle_state", "active")
    .maybeSingle()

  if (error) {
    throw createDatabaseError(error, "Unable to load document.")
  }

  if (!data) {
    throw new TemplateServiceError("Document was not found.", 404)
  }
}

export function mapDocumentTemplate(
  row: DocumentTemplateRow
): DocumentTemplate {
  return {
    id: row.id,
    organizationId: row.org_id,
    title: row.title,
    description: row.description,
    category: row.category ?? null,
    status: parseDocumentTemplateStatus(row.status),
    revision: row.revision,
    content: parseTemplateContent(row.content),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    publishedBy: row.published_by,
    archivedBy: row.archived_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    archivedAt: row.archived_at,
  }
}

/**
 * Maps a templates-list row to the summary the list shows.
 *
 * @param row - Row read with `TEMPLATE_SUMMARY_COLUMNS`.
 * @returns The template without its content.
 */
export function mapDocumentTemplateSummary(
  row: DocumentTemplateSummaryRow
): DocumentTemplateSummary {
  return {
    category: row.category ?? null,
    createdAt: row.created_at,
    id: row.id,
    organizationId: row.org_id,
    revision: row.revision,
    status: parseDocumentTemplateStatus(row.status),
    title: row.title,
    updatedAt: row.updated_at,
  }
}

export function mapGeneratedDocument(
  row: GeneratedDocumentRow
): GeneratedDocument {
  return mapGeneratedDocumentRow(row, {
    createUnsupportedSourceError: (): Error =>
      new TemplateServiceError(
        "Database returned an unsupported generated document source.",
        500
      ),
    parseSnapshot: parseTemplateContent,
  })
}

export function parseDocumentSourceKind(value: string): DocumentSourceKind {
  if (value === "upload" || value === "generated") {
    return value
  }

  throw new TemplateServiceError(
    "Database returned an unsupported document source.",
    500
  )
}

export function normalizeTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, " ")

  if (title.length < 1 || title.length > 180) {
    throw new TemplateServiceError(
      "Title must be between 1 and 180 characters.",
      400
    )
  }

  return title
}

export function normalizeDescription(
  value: string | null | undefined
): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const description = value.trim()

  if (description.length === 0) {
    return null
  }

  if (description.length > 2_000) {
    throw new TemplateServiceError(
      "Description cannot exceed 2,000 characters.",
      400
    )
  }

  return description
}

/**
 * Normalizes an author-supplied category to what the check constraint accepts.
 *
 * Whitespace-only input becomes `null` rather than a blank category, because
 * `document_templates_category_check` rejects untrimmed values and an
 * uncategorised template is a legitimate state.
 *
 * @param value - Raw category from a form or seed definition.
 * @returns A trimmed category, or null when none was supplied.
 * @throws TemplateServiceError when the category is too long.
 */
export function normalizeCategory(
  value: string | null | undefined
): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const category = value.trim().replace(/\s+/g, " ")

  if (category.length === 0) {
    return null
  }

  if (category.length > TEMPLATE_CATEGORY_MAX_LENGTH) {
    throw new TemplateServiceError(
      `Category cannot exceed ${TEMPLATE_CATEGORY_MAX_LENGTH} characters.`,
      400
    )
  }

  return category
}

/**
 * Refuses template images that generated PDFs could not render.
 *
 * PDF rendering decodes every PNG pixel, so the per-image and per-document PNG
 * limits apply at save as well, where the author can still replace the image.
 * An image used more than once is decoded once, so it counts once. JPEGs only
 * need a readable header.
 *
 * @param content - Canonical template content about to be saved.
 * @throws TemplateServiceError when an image is unreadable or its PNGs are too large.
 */
export function assertTemplateImagesRenderable(content: TemplateContent): void {
  const dataUrls = [
    content.branding.logoDataUrl,
    ...content.blocks.map((block: TemplateBlock): string | null =>
      block.type === "image" ? (block.dataUrl ?? null) : null
    ),
  ]
  const storedPngs = new Map<string, TemplateImageAsset>()
  mapImageAssets(content, (asset) => {
    if (asset.type === "png") {
      storedPngs.set(asset.id, asset)
    }
    return asset
  })
  // A stored picture prints from its print copy, no wider than print needs.
  let pngPixels = [...storedPngs.values()].reduce((total, asset) => {
    const fit = Math.min(1, PRINT_MAX_WIDTH / asset.width)
    return total + Math.round(asset.width * fit) * Math.round(asset.height * fit)
  }, 0)

  for (const dataUrl of new Set(dataUrls)) {
    if (!dataUrl) {
      continue
    }

    const image = parseImageDataUrl(dataUrl)
    const dimensions = image
      ? readImageDimensions(Buffer.from(image.encoded, "base64"), image.format)
      : null

    if (!image || !dimensions) {
      throw new TemplateServiceError(
        "An image in this template could not be read.",
        400
      )
    }

    if (exceedsEmbeddedImageLimit(image.format, dimensions)) {
      throw new TemplateServiceError(EMBEDDED_PNG_TOO_LARGE_MESSAGE, 400)
    }

    if (image.format === "png") {
      pngPixels += dimensions.width * dimensions.height
    }
  }

  if (pngPixels > MAX_DOCUMENT_PNG_PIXELS) {
    throw new TemplateServiceError(
      "This template's PNG images add up to more than 64 megapixels. Use smaller images or JPEGs.",
      400
    )
  }
}

export function normalizeNullableId(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export function normalizeRecentLimit(value: number | undefined): number {
  if (value === undefined) {
    return 6
  }

  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new TemplateServiceError(
      "Recent document limit must be between 1 and 20.",
      400
    )
  }

  return value
}

export function assertRevision(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new TemplateServiceError(
      "Expected template revision must be a positive integer.",
      400
    )
  }
}

export function getClient(
  deps: TemplateServiceDeps
): TemplateServiceClient {
  return deps.client ?? createAdminClient()
}

export function createId(deps: TemplateServiceDeps): string {
  return deps.createId ? deps.createId() : randomUUID()
}

export function nowIso(deps: TemplateServiceDeps): string {
  return (deps.now ? deps.now() : new Date()).toISOString()
}

export function createDatabaseError(
  error: unknown,
  fallbackMessage: string
): TemplateServiceError {
  const errorLike = getSupabaseErrorLike(error)

  // A write that kept meeting a colleague's is worth trying again.
  if (isSerializationFailure(errorLike)) {
    return new TemplateServiceError(CONCURRENT_CHANGE_MESSAGE, 409)
  }

  if (errorLike?.code === "23505") {
    return new TemplateServiceError("A conflicting record already exists.", 409)
  }

  if (errorLike?.code === "23514" || errorLike?.code === "22P02") {
    return new TemplateServiceError("Document data failed validation.", 400)
  }

  return new TemplateServiceError(fallbackMessage, 500)
}

export async function runTemplateOperation<T>(
  operationName: string,
  identifiers: Record<string, LogValue>,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now()

  try {
    const result = await operation()
    console.info("template_service_success", {
      operationName,
      durationMs: Date.now() - startedAt,
      ...identifiers,
    })
    return result
  } catch (error: unknown) {
    if (error instanceof TemplateServiceError) {
      console.warn("template_service_rejected", {
        operationName,
        durationMs: Date.now() - startedAt,
        statusCode: error.statusCode,
        reason: error.message,
        ...identifiers,
      })
      throw error
    }

    if (error instanceof ZodError) {
      const validationError = new TemplateServiceError(
        "Document template content is invalid.",
        400
      )
      console.warn("template_service_rejected", {
        operationName,
        durationMs: Date.now() - startedAt,
        statusCode: validationError.statusCode,
        reason: validationError.message,
        ...identifiers,
      })
      throw validationError
    }

    console.error("template_service_failed", {
      operationName,
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : "Unknown service error",
      ...identifiers,
    })
    captureUnexpectedError(error, { operationName, ...identifiers })
    throw new TemplateServiceError("Template service failed.", 500)
  }
}

function parseDocumentTemplateStatus(
  value: string
): DocumentTemplateStatus {
  if (value === "draft" || value === "published" || value === "archived") {
    return value
  }

  throw new TemplateServiceError(
    "Database returned an unsupported template status.",
    500
  )
}

function getSupabaseErrorLike(error: unknown): SupabaseErrorLike | null {
  if (!error || typeof error !== "object") {
    return null
  }

  return error as SupabaseErrorLike
}
