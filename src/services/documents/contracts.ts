import type { AdminSupabaseClient } from "@/lib/supabase/admin"
import type {
  buildDocumentObjectKey,
  createSignedDocumentDownloadUrl,
  createSignedDocumentUploadUrl,
  validateDocumentUploadRequest,
  verifyDocumentUpload,
} from "@/services/document-storage-service"
import type {
  AuditLogAction,
  AuditLogTargetType,
  AuditMetadata,
} from "@/types/audit"

export type DocumentServiceClient = Pick<AdminSupabaseClient, "from" | "rpc">

export type LogValue = string | number | boolean | null | undefined

export type DocumentAuditLogInput = {
  organizationId: string
  actorUserId: string | null
  action: AuditLogAction
  targetType: AuditLogTargetType
  targetId: string
  metadata: AuditMetadata
}

export type CreateFolderInput = {
  actorUserId: string
  organizationId: string
  name: string
  parentFolderId?: string | null
}

export type ListDocumentWorkspaceInput = {
  actorUserId: string
  organizationId: string
}

export type GetDocumentDetailInput = {
  actorUserId: string
  organizationId: string
  documentId: string
}

export type CreateDocumentUploadUrlInput = {
  actorUserId: string
  organizationId: string
  folderId?: string | null
  title: string
  description?: string | null
  originalFilename: string
  contentType: string
  byteSize: number
}

export type CompleteDocumentUploadInput = {
  actorUserId: string
  organizationId: string
  documentId: string
  versionId: string
}

export type CreateDocumentReplacementUploadUrlInput = {
  actorUserId: string
  organizationId: string
  documentId: string
  pendingVersionId?: string | null
  originalFilename: string
  contentType: string
  byteSize: number
}

export type ArchiveDocumentInput = {
  actorUserId: string
  organizationId: string
  documentId: string
}

export type CreateDocumentDownloadUrlInput = {
  actorUserId: string
  organizationId: string
  documentId: string
  versionId?: string | null
}

export type DocumentServiceDeps = {
  client?: DocumentServiceClient
  createId?: () => string
  recordAuditLog?: (input: DocumentAuditLogInput) => Promise<unknown>
  validateDocumentUploadRequest?: typeof validateDocumentUploadRequest
  buildDocumentObjectKey?: typeof buildDocumentObjectKey
  createSignedDocumentUploadUrl?: typeof createSignedDocumentUploadUrl
  createSignedDocumentDownloadUrl?: typeof createSignedDocumentDownloadUrl
  verifyDocumentUpload?: typeof verifyDocumentUpload
}
