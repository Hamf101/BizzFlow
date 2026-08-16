import type { OrganizationPermissionAction } from "@/lib/permissions"
import type { DocumentServiceClient } from "@/services/documents/contracts"
import { DocumentServiceError } from "@/services/documents/errors"
import {
  createSupabaseServiceError,
  requirePermission,
} from "@/services/documents/shared"
import type { DocumentAccessLevel } from "@/types/document"

export type ResourceAccessOperation = "read" | "mutation"

export type DocumentAccessLookupInput = {
  organizationId: string
  documentId: string
  actorUserId: string
}

export type FolderAccessLookupInput = {
  organizationId: string
  folderId: string
  actorUserId: string
}

export type DocumentAccessRequirementInput = DocumentAccessLookupInput & {
  requiredAccess: DocumentAccessLevel
  operation: ResourceAccessOperation
  requiredOrganizationPermissionAction?: OrganizationPermissionAction
}

export type FolderAccessRequirementInput = FolderAccessLookupInput & {
  requiredAccess: DocumentAccessLevel
  operation: ResourceAccessOperation
  requiredOrganizationPermissionAction?: OrganizationPermissionAction
}

/**
 * Loads the actor's effective access to a document.
 *
 * @param input - Organization, document, and actor identifiers.
 * @param client - Injected Supabase service client.
 * @returns Effective access level, or null when the actor has no access.
 * @throws DocumentServiceError when the access lookup fails or returns invalid data.
 */
export async function getEffectiveDocumentAccess(
  input: DocumentAccessLookupInput,
  client: DocumentServiceClient
): Promise<DocumentAccessLevel | null> {
  const { data, error } = await client.rpc("get_document_access_level", {
    target_org_id: input.organizationId,
    target_document_id: input.documentId,
    target_actor_user_id: input.actorUserId,
  })

  if (error) {
    throw createSupabaseServiceError(
      error,
      "Unable to load document access."
    )
  }

  return parseAccessLevel(data, "document")
}

/**
 * Loads the actor's effective access to a folder.
 *
 * @param input - Organization, folder, and actor identifiers.
 * @param client - Injected Supabase service client.
 * @returns Effective access level, or null when the actor has no access.
 * @throws DocumentServiceError when the access lookup fails or returns invalid data.
 */
export async function getEffectiveFolderAccess(
  input: FolderAccessLookupInput,
  client: DocumentServiceClient
): Promise<DocumentAccessLevel | null> {
  const { data, error } = await client.rpc("get_folder_access_level", {
    target_org_id: input.organizationId,
    target_folder_id: input.folderId,
    target_actor_user_id: input.actorUserId,
  })

  if (error) {
    throw createSupabaseServiceError(error, "Unable to load folder access.")
  }

  return parseAccessLevel(data, "folder")
}

/**
 * Requires document-level access and, when supplied, an organization permission.
 *
 * Missing access is always normalized to 404 so callers cannot enumerate
 * private documents. An actor with visible but insufficient access receives
 * 403 only for a mutation.
 *
 * @param input - Access threshold, operation kind, and resource identifiers.
 * @param client - Injected Supabase service client.
 * @returns The actor's effective document access level.
 * @throws DocumentServiceError when access is denied or a lookup fails.
 */
export async function requireDocumentAccess(
  input: DocumentAccessRequirementInput,
  client: DocumentServiceClient
): Promise<DocumentAccessLevel> {
  const accessLevel = await getEffectiveDocumentAccess(input, client)

  requireMinimumAccess(
    accessLevel,
    input.requiredAccess,
    "document",
    input.operation
  )
  await requireOrganizationPermissionWhenRequested(
    input,
    client,
    "document"
  )

  return accessLevel
}

/**
 * Requires folder-level access and, when supplied, an organization permission.
 *
 * Missing access is always normalized to 404 so callers cannot enumerate
 * private folders. An actor with visible but insufficient access receives
 * 403 only for a mutation.
 *
 * @param input - Access threshold, operation kind, and resource identifiers.
 * @param client - Injected Supabase service client.
 * @returns The actor's effective folder access level.
 * @throws DocumentServiceError when access is denied or a lookup fails.
 */
export async function requireFolderAccess(
  input: FolderAccessRequirementInput,
  client: DocumentServiceClient
): Promise<DocumentAccessLevel> {
  const accessLevel = await getEffectiveFolderAccess(input, client)

  requireMinimumAccess(
    accessLevel,
    input.requiredAccess,
    "folder",
    input.operation
  )
  await requireOrganizationPermissionWhenRequested(
    input,
    client,
    "folder"
  )

  return accessLevel
}

function parseAccessLevel(
  value: unknown,
  resourceName: "document" | "folder"
): DocumentAccessLevel | null {
  if (value === null || value === "viewer" || value === "contributor") {
    return value
  }

  throw new DocumentServiceError(
    `Database returned an unsupported ${resourceName} access level.`,
    500
  )
}

function requireMinimumAccess(
  actualAccess: DocumentAccessLevel | null,
  requiredAccess: DocumentAccessLevel,
  resourceName: "document" | "folder",
  operation: ResourceAccessOperation
): asserts actualAccess is DocumentAccessLevel {
  const accessRank: Record<DocumentAccessLevel, number> = {
    viewer: 1,
    contributor: 2,
  }

  if (actualAccess === null) {
    throw createAccessDeniedError(resourceName, "read")
  }

  if (accessRank[actualAccess] < accessRank[requiredAccess]) {
    throw createAccessDeniedError(resourceName, operation)
  }
}

async function requireOrganizationPermissionWhenRequested(
  input:
    | DocumentAccessRequirementInput
    | FolderAccessRequirementInput,
  client: DocumentServiceClient,
  resourceName: "document" | "folder"
): Promise<void> {
  const action = input.requiredOrganizationPermissionAction

  if (!action) {
    return
  }

  try {
    await requirePermission(
      client,
      input.organizationId,
      input.actorUserId,
      action,
      `You cannot access this ${resourceName}.`
    )
  } catch (error: unknown) {
    if (error instanceof DocumentServiceError && error.statusCode === 403) {
      throw createAccessDeniedError(resourceName, input.operation)
    }

    throw error
  }
}

function createAccessDeniedError(
  resourceName: "document" | "folder",
  operation: ResourceAccessOperation
): DocumentServiceError {
  if (operation === "read") {
    const displayName =
      resourceName === "document" ? "Document" : "Folder"
    return new DocumentServiceError(`${displayName} was not found.`, 404)
  }

  return new DocumentServiceError(
    `You do not have sufficient access to modify this ${resourceName}.`,
    403
  )
}
