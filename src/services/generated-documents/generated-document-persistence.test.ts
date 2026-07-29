import { describe, expect, it } from "vitest"

import {
  GENERATED_DOCUMENT_COLUMNS,
  mapGeneratedDocumentRow,
  type GeneratedDocumentRow,
} from "@/services/generated-documents/generated-document-persistence"
import {
  createBlankTemplateContent,
  parseTemplateContent,
} from "@/types/template"

const GENERATED_DOCUMENT_ROW: GeneratedDocumentRow = {
  id: "10000000-0000-4000-8000-000000000001",
  org_id: "20000000-0000-4000-8000-000000000001",
  folder_id: "30000000-0000-4000-8000-000000000001",
  title: "Professional services agreement",
  description: "Prepared for the client",
  source_kind: "generated",
  template_id: "40000000-0000-4000-8000-000000000001",
  template_revision: 3,
  template_snapshot: createBlankTemplateContent(),
  lifecycle_state: "active",
  created_by: "50000000-0000-4000-8000-000000000001",
  updated_by: "50000000-0000-4000-8000-000000000002",
  archived_at: null,
  trashed_at: null,
  purge_after: null,
  created_at: "2026-07-17T19:00:00.000Z",
  updated_at: "2026-07-17T20:00:00.000Z",
}

describe("generated document persistence", () => {
  it("maps every projected persistence field to the domain contract", () => {
    const document = mapGeneratedDocumentRow(GENERATED_DOCUMENT_ROW, {
      createUnsupportedSourceError: (sourceKind: string): Error =>
        new Error(`Unsupported source: ${sourceKind}`),
      parseSnapshot: parseTemplateContent,
    })

    expect(GENERATED_DOCUMENT_COLUMNS.split(",")).toEqual([
      "id",
      "org_id",
      "folder_id",
      "title",
      "description",
      "source_kind",
      "template_id",
      "template_revision",
      "template_snapshot",
      "lifecycle_state",
      "created_by",
      "updated_by",
      "archived_at",
      "trashed_at",
      "purge_after",
      "created_at",
      "updated_at",
    ])
    expect(document).toEqual({
      id: GENERATED_DOCUMENT_ROW.id,
      organizationId: GENERATED_DOCUMENT_ROW.org_id,
      folderId: GENERATED_DOCUMENT_ROW.folder_id,
      title: GENERATED_DOCUMENT_ROW.title,
      description: GENERATED_DOCUMENT_ROW.description,
      sourceKind: "generated",
      templateId: GENERATED_DOCUMENT_ROW.template_id,
      templateRevision: GENERATED_DOCUMENT_ROW.template_revision,
      templateSnapshot: GENERATED_DOCUMENT_ROW.template_snapshot,
      lifecycleState: "active",
      createdBy: GENERATED_DOCUMENT_ROW.created_by,
      updatedBy: GENERATED_DOCUMENT_ROW.updated_by,
      archivedAt: GENERATED_DOCUMENT_ROW.archived_at,
      trashedAt: null,
      purgeAfter: null,
      createdAt: GENERATED_DOCUMENT_ROW.created_at,
      updatedAt: GENERATED_DOCUMENT_ROW.updated_at,
    })
  })

  it("delegates unsupported-source errors to the calling service", () => {
    const unsupportedSourceError = new Error("Upload rows are not supported.")

    expect(() =>
      mapGeneratedDocumentRow(
        { ...GENERATED_DOCUMENT_ROW, source_kind: "upload" },
        {
          createUnsupportedSourceError: (): Error => unsupportedSourceError,
          parseSnapshot: parseTemplateContent,
        }
      )
    ).toThrow(unsupportedSourceError)
  })

  it("uses a caller-provided snapshot parser without changing its errors", () => {
    const invalidSnapshotError = new Error("Invalid stored snapshot.")

    expect(() =>
      mapGeneratedDocumentRow(GENERATED_DOCUMENT_ROW, {
        createUnsupportedSourceError: (sourceKind: string): Error =>
          new Error(`Unsupported source: ${sourceKind}`),
        parseSnapshot: (): never => {
          throw invalidSnapshotError
        },
      })
    ).toThrow(invalidSnapshotError)
  })
})
