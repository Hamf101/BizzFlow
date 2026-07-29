import type { AdminSupabaseClient } from "@/lib/supabase/admin"
import type { deleteDocumentStorageObject } from "@/services/document-storage-service"
import type { DocumentLifecycleState } from "@/types/document"

// Manual purge requests additionally read resource access and membership, so
// this matches DocumentServiceClient rather than the rpc-only surface the
// scheduled batch needs.
export type ResourcePurgeServiceClient = Pick<
  AdminSupabaseClient,
  "from" | "rpc"
>

export type ResourcePurgeObjectFailureDisposition =
  | "retry_wait"
  | "failed"

export type LeasedResourcePurgeObject = {
  object_id: string
  job_id: string
  storage_key: string
  lease_token: string
  attempt_count: number
}

export type RequestDocumentPurgeInput = {
  actorUserId: string
  organizationId: string
  documentId: string
  confirmationTitle: string
}

export type RequestFolderPurgeInput = {
  actorUserId: string
  organizationId: string
  folderId: string
  confirmationName: string
}

export type ResourcePurgeRequestResult = {
  jobId: string
  lifecycleState: Extract<DocumentLifecycleState, "purge_pending">
}

export type ProcessDueResourcePurgesOptions = {
  jobLimit?: number
  objectLimit?: number
  leaseSeconds?: number
}

export type ProcessDueResourcePurgesResult = {
  enqueued: number
  leased: number
  deleted: number
  retryScheduled: number
  permanentlyFailed: number
  finalized: number
}

export type ResourcePurgeServiceDeps = {
  client?: ResourcePurgeServiceClient
  createId?: () => string
  deleteDocumentStorageObject?: typeof deleteDocumentStorageObject
}
