export type DocumentVersionStatus = "upload_pending" | "available"

export type FolderRow = Record<string, unknown> & {
  id: string
  org_id: string
  parent_folder_id: string | null
  name: string
  created_by: string | null
  updated_by: string | null
  archived_by: string | null
  archived_at: string | null
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
  created_by: string | null
  updated_by: string | null
  archived_by: string | null
  archived_at: string | null
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
  createdBy: string | null
  updatedBy: string | null
  archivedBy: string | null
  archivedAt: string | null
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
  createdBy: string | null
  updatedBy: string | null
  archivedBy: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
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
  checksumSha256: string | null
  uploadedBy: string | null
  createdAt: string
  updatedAt: string
}

export type DocumentWorkspace = {
  folders: DocumentFolder[]
  documents: DocumentSummary[]
}

export type DocumentDetail = {
  document: DocumentSummary
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
