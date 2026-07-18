import type { GeneratedDocument, TemplateContent } from "@/types/template"

/** Canonical database projection required to hydrate a generated document. */
export const GENERATED_DOCUMENT_COLUMNS =
  "id,org_id,folder_id,title,description,source_kind,template_id,template_revision,template_snapshot,created_by,updated_by,archived_at,created_at,updated_at"

/** Persistence shape returned by the generated-document database projection. */
export type GeneratedDocumentRow = Record<string, unknown> & {
  id: string
  org_id: string
  folder_id: string | null
  title: string
  description: string | null
  source_kind: string
  template_id: string | null
  template_revision: number | null
  template_snapshot: unknown
  created_by: string | null
  updated_by: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

/** Service-specific behavior required while mapping a generated-document row. */
export type GeneratedDocumentRowMapperOptions = {
  createUnsupportedSourceError: (sourceKind: string) => Error
  parseSnapshot: (value: unknown) => TemplateContent
}

/**
 * Maps a generated-document persistence row to the shared domain model.
 *
 * @param row - Database row returned by {@link GENERATED_DOCUMENT_COLUMNS}.
 * @param options - Service-specific unsupported-source error and snapshot parser.
 * @returns Canonical generated-document domain data.
 * @throws Error returned by `createUnsupportedSourceError` for non-generated rows.
 * @throws Error from the configured snapshot parser when stored content is invalid.
 */
export function mapGeneratedDocumentRow(
  row: GeneratedDocumentRow,
  options: GeneratedDocumentRowMapperOptions
): GeneratedDocument {
  if (row.source_kind !== "generated") {
    throw options.createUnsupportedSourceError(row.source_kind)
  }

  return {
    id: row.id,
    organizationId: row.org_id,
    folderId: row.folder_id,
    title: row.title,
    description: row.description,
    sourceKind: "generated",
    templateId: row.template_id,
    templateRevision: row.template_revision,
    templateSnapshot: options.parseSnapshot(row.template_snapshot),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
