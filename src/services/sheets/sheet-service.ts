import { ZodError } from "zod"

import { evaluateSheet } from "@/lib/sheet/evaluate"
import {
  requireDocumentReader,
  requireDocumentWriter,
  requireFolderAccess,
  requireReadableDocument,
} from "@/services/documents/access-service"
import { recordDocumentAuditLog } from "@/services/documents/audit"
import type { DocumentServiceClient } from "@/services/documents/contracts"
import {
  createId,
  createSupabaseServiceError,
  DOCUMENT_COLUMNS,
  getClient,
  mapDocument,
  normalizeNullableId,
  requireActiveFolder,
  requirePermission,
} from "@/services/documents/shared"
import { normalizeName } from "@/services/input"
import { runOperation } from "@/services/operation"
import { retrySerializationFailure } from "@/services/serialization-retry"
import { ServiceError } from "@/services/service-error"
import type {
  CreateSheetInput,
  RenameSheetInput,
  Sheet,
  SheetInput,
  SheetServiceDeps,
  UpdateSheetContentInput,
} from "@/services/sheets/contracts"
import { SheetServiceError } from "@/services/sheets/errors"
import { asSupabaseError } from "@/services/supabase-error"
import type { DocumentRow, DocumentSummary } from "@/types/document"
import { parseSheetContent, type SheetContent } from "@/types/sheet"

const EMPTY_SHEET: SheetContent = { version: 1, tabs: [{ id: "t1", name: "Sheet1", cells: {} }] }

/**
 * Creates an empty sheet: a document with one blank tab, "Sheet1".
 *
 * @param input - Actor, organization, title and optional folder.
 * @param deps - Injected client, ids and audit for tests.
 * @returns The new document, of kind "sheet".
 * @throws SheetServiceError 403 without documents:create or the folder's contributor access, 400 for a bad title.
 */
export async function createSheet(input: CreateSheetInput, deps: SheetServiceDeps = {}): Promise<DocumentSummary> {
  return runSheetOperation("create_sheet", input, async () => {
    const client = getClient(deps)
    const membership = await requirePermission(client, input.organizationId, input.actorUserId, "documents:create", "You cannot create documents.")
    const folderId = normalizeNullableId(input.folderId)

    if (folderId) {
      await requireFolderAccess(
        { actorUserId: input.actorUserId, organizationId: input.organizationId, folderId, requiredAccess: "contributor", operation: "mutation" },
        client
      )
      await requireActiveFolder(client, input.organizationId, folderId)
    }

    const title = normalizeTitle(input.title)
    const id = createId(deps)
    // The insert takes the folder tree's lock without waiting, so a
    // colleague's write at the same instant asks for a retry.
    const { data, error } = await retrySerializationFailure(() =>
      client
        .from("documents")
        .insert({
          id,
          org_id: input.organizationId,
          folder_id: folderId,
          title,
          description: null,
          current_version_id: null,
          source_kind: "sheet",
          sheet_content: EMPTY_SHEET,
          created_by: input.actorUserId,
          updated_by: input.actorUserId,
        })
        .select(DOCUMENT_COLUMNS)
        .single()
    )

    if (error || !data) throw databaseError(error, "Unable to create the sheet.")

    const document = mapDocument(data as DocumentRow)

    await recordDocumentAuditLog(deps, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "document.created",
      targetType: "document",
      targetId: document.id,
      metadata: { title, role: membership.role, sourceKind: "sheet" },
    })

    return document
  })
}

/**
 * Opens a sheet for anyone who may read the document, guests included.
 *
 * @param input - Actor, organization and the sheet.
 * @param deps - Injected client for tests.
 * @returns Its title, content, version stamp and the reader's level.
 * @throws SheetServiceError 404 when the actor cannot read it or it is no sheet.
 */
export async function getSheet(input: SheetInput, deps: SheetServiceDeps = {}): Promise<Sheet> {
  return runSheetOperation("get_sheet", input, async () => {
    const client = getClient(deps)
    const { accessLevel } = await requireDocumentReader(input, client)
    const result = await client
      .from("documents")
      .select("id,title,sheet_content,updated_at,lifecycle_state")
      .eq("id", input.documentId)
      .eq("org_id", input.organizationId)
      .eq("source_kind", "sheet")
      .maybeSingle()

    requireReadableDocument(result, sheetReadFailures)

    const row = result.data!

    // Every write went through parseSheetContent, so the stored sheet is trusted.
    return { id: row.id, title: row.title, content: row.sheet_content!, updatedAt: row.updated_at, accessLevel }
  })
}

/**
 * Saves a sheet's content over the version its writer opened.
 *
 * @param input - Actor, organization, sheet, untrusted content and the opened version stamp.
 * @param deps - Injected client and clock for tests.
 * @returns The new version stamp.
 * @throws SheetServiceError 400 for content past a cap, 422 when it is too heavy to work out,
 *   403 for a viewer, 404 when unseen, 409 when someone saved first or it is archived.
 */
export async function updateSheetContent(
  input: UpdateSheetContentInput,
  deps: SheetServiceDeps = {}
): Promise<{ updatedAt: string }> {
  return runSheetOperation("update_sheet_content", input, async () => {
    const client = getClient(deps)

    await requireDocumentWriter(input, client)

    const content = parseSheetContent(input.content)

    // Worked out once to enforce the engine's budget; the values are not stored.
    try {
      evaluateSheet(content, { now: deps.now?.() ?? new Date() })
    } catch (error: unknown) {
      if (error instanceof RangeError) {
        throw new SheetServiceError("This sheet is too heavy to work out. Simplify its formulas.", 422)
      }

      throw error
    }

    return writeSheet(client, input, { sheet_content: content, updated_by: input.actorUserId })
  })
}

/**
 * Renames a sheet over the version its writer opened.
 *
 * @param input - Actor, organization, sheet, new title and the opened version stamp.
 * @param deps - Injected client for tests.
 * @returns The new version stamp.
 * @throws SheetServiceError as updateSheetContent does, and 400 for a bad title.
 */
export async function renameSheet(input: RenameSheetInput, deps: SheetServiceDeps = {}): Promise<{ updatedAt: string }> {
  return runSheetOperation("rename_sheet", input, async () => {
    const client = getClient(deps)

    await requireDocumentWriter(input, client)

    return writeSheet(client, input, { title: normalizeTitle(input.title), updated_by: input.actorUserId })
  })
}

async function writeSheet(
  client: DocumentServiceClient,
  input: SheetInput & { expectedUpdatedAt: string },
  patch: { sheet_content: SheetContent; updated_by: string } | { title: string; updated_by: string }
): Promise<{ updatedAt: string }> {
  if (Number.isNaN(Date.parse(input.expectedUpdatedAt))) {
    throw new SheetServiceError("Reload the sheet and try again.", 400)
  }

  const { data, error } = await client
    .from("documents")
    .update(patch)
    .eq("id", input.documentId)
    .eq("org_id", input.organizationId)
    .eq("source_kind", "sheet")
    .eq("lifecycle_state", "active")
    .eq("updated_at", input.expectedUpdatedAt)
    .select("updated_at")
    .maybeSingle()

  if (error) throw databaseError(error, "Unable to save the sheet.")
  if (data) return { updatedAt: data.updated_at }

  // Nothing matched: tell a sheet that is gone from one saved since it was opened.
  const current = await client
    .from("documents")
    .select("lifecycle_state")
    .eq("id", input.documentId)
    .eq("org_id", input.organizationId)
    .eq("source_kind", "sheet")
    .maybeSingle()

  requireReadableDocument(current, {
    ...sheetReadFailures,
    archived: () => new SheetServiceError("An archived sheet cannot be changed.", 409),
  })

  throw new SheetServiceError("This sheet changed since you opened it. Reload it and try again.", 409)
}

const sheetReadFailures = {
  loadFailed: (error: unknown) => createSupabaseServiceError(error, "Unable to load the sheet."),
  notFound: () => new SheetServiceError("Sheet was not found.", 404),
}

function normalizeTitle(title: string): string {
  return normalizeName(title, "Sheet title", 1, 180, (message) => new SheetServiceError(message, 400))
}

// The database's size cap on a sheet is a check constraint.
function databaseError(error: unknown, fallbackMessage: string): Error {
  return asSupabaseError(error)?.code === "23514"
    ? new SheetServiceError("This sheet is too large to save.", 400)
    : createSupabaseServiceError(error, fallbackMessage)
}

function runSheetOperation<T>(
  operationName: string,
  input: { actorUserId: string; organizationId: string; documentId?: string },
  operation: () => Promise<T>
): Promise<T> {
  return runOperation(
    "sheet",
    toSheetServiceError,
    operationName,
    { actorUserId: input.actorUserId, organizationId: input.organizationId, documentId: input.documentId ?? null },
    operation
  )
}

// Document access and lookup errors keep their status; raw errors never leave.
function toSheetServiceError(error: unknown): SheetServiceError {
  if (error instanceof SheetServiceError) return error
  if (error instanceof ServiceError) return new SheetServiceError(error.message, error.statusCode, { cause: error })
  if (error instanceof ZodError) return new SheetServiceError("This sheet breaks a rule or is over a limit.", 400)

  return new SheetServiceError("Sheet service failed.", 500, { cause: error })
}
