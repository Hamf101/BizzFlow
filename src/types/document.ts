export type DocumentVersionStatus = "upload_pending" | "available"
export type DocumentAccessLevel = "viewer" | "contributor"
export type DocumentLifecycleState =
  | "active"
  | "archived"
  | "trashed"
  | "purge_pending"

export type FolderRow = Record<string, unknown> & {
  id: string
  org_id: string
  parent_folder_id: string | null
  name: string
  lifecycle_state: DocumentLifecycleState
  created_by: string | null
  updated_by: string | null
  archived_by: string | null
  archived_at: string | null
  trashed_by: string | null
  trashed_at: string | null
  purge_after: string | null
  pre_trash_lifecycle_state: DocumentLifecycleState | null
  trash_operation_id: string | null
  created_at: string
  updated_at: string
}

export type DocumentRow = Record<string, unknown> & {
  id: string
  org_id: string
  folder_id: string | null
  title: string
  description: string | null
  current_version_id: string | null
  source_kind?: string
  template_id?: string | null
  template_revision?: number | null
  lifecycle_state: DocumentLifecycleState
  created_by: string | null
  updated_by: string | null
  archived_by: string | null
  archived_at: string | null
  trashed_by: string | null
  trashed_at: string | null
  purge_after: string | null
  pre_trash_lifecycle_state: DocumentLifecycleState | null
  trash_operation_id: string | null
  created_at: string
  updated_at: string
}

export type DocumentVersionRow = Record<string, unknown> & {
  id: string
  org_id: string
  document_id: string
  version_number: number
  status: string
  storage_key: string
  original_filename: string
  content_type: string
  byte_size: number
  checksum_sha256: string | null
  uploaded_by: string | null
  created_at: string
  updated_at: string
}

export type DocumentFolder = {
  id: string
  organizationId: string
  parentFolderId: string | null
  name: string
  lifecycleState: DocumentLifecycleState
  createdBy: string | null
  updatedBy: string | null
  archivedBy: string | null
  archivedAt: string | null
  trashedBy: string | null
  trashedAt: string | null
  purgeAfter: string | null
  preTrashLifecycleState: DocumentLifecycleState | null
  trashOperationId: string | null
  createdAt: string
  updatedAt: string
}

export type DocumentSummary = {
  id: string
  organizationId: string
  folderId: string | null
  title: string
  description: string | null
  currentVersionId: string | null
  sourceKind?: "upload" | "generated"
  templateId?: string | null
  templateRevision?: number | null
  lifecycleState: DocumentLifecycleState
  createdBy: string | null
  updatedBy: string | null
  archivedBy: string | null
  archivedAt: string | null
  trashedBy: string | null
  trashedAt: string | null
  purgeAfter: string | null
  preTrashLifecycleState: DocumentLifecycleState | null
  trashOperationId: string | null
  createdAt: string
  updatedAt: string
}

export type AccessibleDocumentFolder = DocumentFolder & {
  accessLevel: DocumentAccessLevel
}

export type AccessibleDocumentSummary = DocumentSummary & {
  accessLevel: DocumentAccessLevel
}

export type DocumentVersion = {
  id: string
  organizationId: string
  documentId: string
  versionNumber: number
  status: DocumentVersionStatus
  storageKey: string
  originalFilename: string
  contentType: string
  byteSize: number
  uploadedBy: string | null
  createdAt: string
  updatedAt: string
}

export type DocumentWorkspace = {
  folders: AccessibleDocumentFolder[]
  documents: AccessibleDocumentSummary[]
}

export type DocumentDetail = {
  document: AccessibleDocumentSummary
  versions: DocumentVersion[]
}

export type CreateDocumentUploadUrlResponse = {
  documentId: string
  versionId: string
  uploadUrl: string
  storageKey: string
  expiresInSeconds: number
}

export type CreateDocumentDownloadUrlResponse = {
  documentId: string
  versionId: string
  downloadUrl: string
  expiresInSeconds: number
}
