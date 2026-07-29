import { randomUUID } from "node:crypto"

import { createAdminClient } from "@/lib/supabase/admin"
import { deleteDocumentStorageObject } from "@/services/document-storage-service"
import {
  requireDocumentAccess,
  requireFolderAccess,
} from "@/services/documents/access-service"
import type {
  LeasedResourcePurgeObject,
  ProcessDueResourcePurgesOptions,
  ProcessDueResourcePurgesResult,
  RequestDocumentPurgeInput,
  RequestFolderPurgeInput,
  ResourcePurgeObjectFailureDisposition,
  ResourcePurgeRequestResult,
  ResourcePurgeServiceClient,
  ResourcePurgeServiceDeps,
} from "@/services/documents/purge-contracts"
import { DocumentServiceError } from "@/services/documents/errors"
import {
  createSupabaseServiceError,
  runDocumentOperation,
} from "@/services/documents/shared"

const DEFAULT_JOB_LIMIT = 10
const DEFAULT_OBJECT_LIMIT = 25
const DEFAULT_LEASE_SECONDS = 120
const MAX_JOB_LIMIT = 100
const MAX_OBJECT_LIMIT = 100
const MIN_LEASE_SECONDS = 15
const MAX_LEASE_SECONDS = 600

type SupabaseErrorLike = {
  code?: string
  details?: string
  hint?: string
  message?: string
}

/**
 * Atomically queues permanent deletion of one trashed document.
 *
 * Contributor access plus `documents:archive` is required here; the database
 * remains authoritative for creator/owner authorization, retention protection,
 * exact title confirmation, and idempotency.
 *
 * @param input - Actor, tenant, document, and exact confirmation title.
 * @param deps - Optional purge dependencies for tests.
 * @returns The durable purge job and irreversible lifecycle state.
 * @throws DocumentServiceError when validation, authorization, state, or
 * persistence checks fail.
 */
export async function requestDocumentPurge(
  input: RequestDocumentPurgeInput,
  deps: ResourcePurgeServiceDeps = {}
): Promise<ResourcePurgeRequestResult> {
  return runDocumentOperation(
    "request_document_purge",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      documentId: input.documentId,
    },
    async (): Promise<ResourcePurgeRequestResult> => {
      requireConfirmation(input.confirmationTitle, "confirmationTitle")
      const client = getPurgeClient(deps)

      // Normalizes an invisible document to 404 before the request reaches the
      // database, so no member can probe ids or titles they cannot already see.
      await requireDocumentAccess(
        {
          actorUserId: input.actorUserId,
          organizationId: input.organizationId,
          documentId: input.documentId,
          requiredAccess: "contributor",
          operation: "mutation",
          requiredOrganizationPermissionAction: "documents:archive",
        },
        client
      )
      const jobId = (deps.createId ?? randomUUID)()
      const { data, error } = await client.rpc("request_document_purge", {
        target_org_id: input.organizationId,
        target_document_id: input.documentId,
        target_actor_user_id: input.actorUserId,
        target_confirmation_title: input.confirmationTitle,
        target_job_id: jobId,
      })

      if (error) {
        throw createManualPurgeError(error, "document")
      }

      if (typeof data !== "string" || data.length === 0) {
        throw new DocumentServiceError(
          "Unable to queue document purge.",
          500
        )
      }

      return {
        jobId: data,
        lifecycleState: "purge_pending",
      }
    }
  )
}

/**
 * Atomically queues permanent deletion of a trashed folder's physical subtree.
 *
 * Contributor access plus `folders:manage` is required here; the database then
 * locks and inventories the complete subtree, applies creator or owner
 * authorization, and requires an exact folder-name confirmation.
 *
 * @param input - Actor, tenant, folder, and exact confirmation name.
 * @param deps - Optional purge dependencies for tests.
 * @returns The durable purge job and irreversible lifecycle state.
 * @throws DocumentServiceError when validation, authorization, state, or
 * persistence checks fail.
 */
export async function requestFolderPurge(
  input: RequestFolderPurgeInput,
  deps: ResourcePurgeServiceDeps = {}
): Promise<ResourcePurgeRequestResult> {
  return runDocumentOperation(
    "request_folder_purge",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      folderId: input.folderId,
    },
    async (): Promise<ResourcePurgeRequestResult> => {
      requireConfirmation(input.confirmationName, "confirmationName")
      const client = getPurgeClient(deps)

      // Same enumeration guard as the document path; the database still applies
      // creator-or-owner authorization over the locked subtree.
      await requireFolderAccess(
        {
          actorUserId: input.actorUserId,
          organizationId: input.organizationId,
          folderId: input.folderId,
          requiredAccess: "contributor",
          operation: "mutation",
          requiredOrganizationPermissionAction: "folders:manage",
        },
        client
      )
      const jobId = (deps.createId ?? randomUUID)()
      const { data, error } = await client.rpc("request_folder_purge", {
        target_org_id: input.organizationId,
        target_folder_id: input.folderId,
        target_actor_user_id: input.actorUserId,
        target_confirmation_name: input.confirmationName,
        target_job_id: jobId,
      })

      if (error) {
        throw createManualPurgeError(error, "folder")
      }

      if (typeof data !== "string" || data.length === 0) {
        throw new DocumentServiceError("Unable to queue folder purge.", 500)
      }

      return {
        jobId: data,
        lifecycleState: "purge_pending",
      }
    }
  )
}

/**
 * Enqueues due ordinary trash, processes one leased R2 batch, and finalizes
 * database deletion for jobs whose objects are all absent.
 *
 * Every bound is validated before work starts. Object failures are isolated,
 * recorded with a safe code, and leave the resource in `purge_pending`.
 *
 * @param options - Optional bounded job, object, and lease limits.
 * @param deps - Optional purge dependencies for tests.
 * @returns Content-free processing counts suitable for a cron response.
 * @throws DocumentServiceError when database orchestration fails.
 */
export async function processDueResourcePurges(
  options: ProcessDueResourcePurgesOptions = {},
  deps: ResourcePurgeServiceDeps = {}
): Promise<ProcessDueResourcePurgesResult> {
  const startedAt = Date.now()
  const jobLimit = validateIntegerBound(
    options.jobLimit ?? DEFAULT_JOB_LIMIT,
    "jobLimit",
    1,
    MAX_JOB_LIMIT
  )
  const objectLimit = validateIntegerBound(
    options.objectLimit ?? DEFAULT_OBJECT_LIMIT,
    "objectLimit",
    1,
    MAX_OBJECT_LIMIT
  )
  const leaseSeconds = validateIntegerBound(
    options.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
    "leaseSeconds",
    MIN_LEASE_SECONDS,
    MAX_LEASE_SECONDS
  )
  const client = getPurgeClient(deps)
  const deleteObject =
    deps.deleteDocumentStorageObject ?? deleteDocumentStorageObject

  try {
    const enqueued = await enqueueDuePurges(client, jobLimit)
    const leasedObjects = await leasePurgeObjects(
      client,
      objectLimit,
      leaseSeconds
    )
    let deleted = 0
    let retryScheduled = 0
    let permanentlyFailed = 0

    for (const object of leasedObjects) {
      try {
        await deleteObject({ storageKey: object.storage_key })
      } catch {
        const disposition = await recordObjectFailure(client, object)

        if (disposition === "retry_wait") {
          retryScheduled += 1
        } else {
          permanentlyFailed += 1
        }

        console.error("resource_purge_object_failed", {
          jobId: object.job_id,
          objectId: object.object_id,
          disposition,
        })
        continue
      }

      await completeObjectDelete(client, object)
      deleted += 1
    }

    const finalized = await finalizeReadyPurges(client, jobLimit)
    const result: ProcessDueResourcePurgesResult = {
      enqueued,
      leased: leasedObjects.length,
      deleted,
      retryScheduled,
      permanentlyFailed,
      finalized,
    }

    console.info("resource_purge_batch_completed", {
      ...result,
      durationMs: Date.now() - startedAt,
    })
    return result
  } catch (error: unknown) {
    if (error instanceof DocumentServiceError) {
      throw error
    }

    console.error("resource_purge_batch_failed", {
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.name : "Unknown purge error",
    })
    throw createSupabaseServiceError(error, "Unable to process document purge.")
  }
}

function getPurgeClient(
  deps: ResourcePurgeServiceDeps
): ResourcePurgeServiceClient {
  return deps.client ?? createAdminClient()
}

function requireConfirmation(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new DocumentServiceError(`${fieldName} is required.`, 400)
  }
}

function validateIntegerBound(
  value: number,
  fieldName: string,
  minimum: number,
  maximum: number
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new DocumentServiceError(
      `${fieldName} must be an integer between ${minimum} and ${maximum}.`,
      400
    )
  }

  return value
}

async function enqueueDuePurges(
  client: ResourcePurgeServiceClient,
  targetLimit: number
): Promise<number> {
  const { data, error } = await client.rpc("enqueue_due_resource_purges", {
    target_limit: targetLimit,
  })

  if (error) {
    throw createSupabaseServiceError(error, "Unable to queue due purges.")
  }

  return requireCount(data, "enqueue due purges")
}

async function leasePurgeObjects(
  client: ResourcePurgeServiceClient,
  targetLimit: number,
  targetLeaseSeconds: number
): Promise<LeasedResourcePurgeObject[]> {
  const { data, error } = await client.rpc("lease_resource_purge_objects", {
    target_limit: targetLimit,
    target_lease_seconds: targetLeaseSeconds,
  })

  if (error) {
    throw createSupabaseServiceError(error, "Unable to lease purge objects.")
  }

  return Array.isArray(data)
    ? (data as LeasedResourcePurgeObject[])
    : []
}

async function completeObjectDelete(
  client: ResourcePurgeServiceClient,
  object: LeasedResourcePurgeObject
): Promise<void> {
  const { data, error } = await client.rpc(
    "complete_resource_purge_object",
    {
      target_object_id: object.object_id,
      target_lease_token: object.lease_token,
    }
  )

  if (error || data !== true) {
    throw createSupabaseServiceError(
      error ?? new Error("Purge object lease was not completed."),
      "Unable to complete purge object."
    )
  }
}

async function recordObjectFailure(
  client: ResourcePurgeServiceClient,
  object: LeasedResourcePurgeObject
): Promise<ResourcePurgeObjectFailureDisposition> {
  const { data, error } = await client.rpc("fail_resource_purge_object", {
    target_object_id: object.object_id,
    target_lease_token: object.lease_token,
    target_error_code: "storage_delete_failed",
  })

  if (error || (data !== "retry_wait" && data !== "failed")) {
    throw createSupabaseServiceError(
      error ?? new Error("Purge object failure was not recorded."),
      "Unable to record purge object failure."
    )
  }

  return data
}

async function finalizeReadyPurges(
  client: ResourcePurgeServiceClient,
  targetLimit: number
): Promise<number> {
  const { data, error } = await client.rpc(
    "finalize_ready_resource_purges",
    {
      target_limit: targetLimit,
    }
  )

  if (error) {
    throw createSupabaseServiceError(error, "Unable to finalize purges.")
  }

  return requireCount(data, "finalize purges")
}

function requireCount(value: unknown, operationName: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new DocumentServiceError(
      `Unable to ${operationName}: invalid database response.`,
      500
    )
  }

  return value as number
}

function createManualPurgeError(
  error: unknown,
  resourceKind: "document" | "folder"
): DocumentServiceError {
  const errorLike =
    error && typeof error === "object"
      ? (error as SupabaseErrorLike)
      : null

  if (errorLike?.code === "P0002") {
    return new DocumentServiceError(
      `${capitalize(resourceKind)} was not found.`,
      404
    )
  }

  if (errorLike?.code === "42501") {
    return new DocumentServiceError(
      `You are not allowed to purge this ${resourceKind}.`,
      403
    )
  }

  if (errorLike?.code === "22023") {
    return new DocumentServiceError(
      `${capitalize(resourceKind)} purge confirmation did not match.`,
      400
    )
  }

  if (
    errorLike?.code === "P0001" ||
    errorLike?.code === "23514" ||
    errorLike?.code === "23505"
  ) {
    return new DocumentServiceError(
      `Unable to purge ${resourceKind} in its current state.`,
      409
    )
  }

  return createSupabaseServiceError(
    error,
    `Unable to queue ${resourceKind} purge.`
  )
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}
