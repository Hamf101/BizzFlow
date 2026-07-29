export type {
  ArchiveDocumentInput,
  CompleteDocumentUploadInput,
  CreateDocumentDownloadUrlInput,
  CreateDocumentReplacementUploadUrlInput,
  CreateDocumentUploadUrlInput,
  CreateFolderInput,
  DocumentServiceDeps,
  FolderLifecycleInput,
  GetDocumentDetailInput,
  ListDocumentWorkspaceInput,
  RestoreDocumentInput,
  TrashDocumentInput,
} from "@/services/documents/contracts"
export type {
  ProcessDueResourcePurgesOptions,
  ProcessDueResourcePurgesResult,
  RequestDocumentPurgeInput,
  RequestFolderPurgeInput,
  ResourcePurgeRequestResult,
} from "@/services/documents/purge-contracts"
export type {
  DocumentAccessLookupInput,
  DocumentAccessRequirementInput,
  FolderAccessLookupInput,
  FolderAccessRequirementInput,
  ResourceAccessOperation,
} from "@/services/documents/access-service"
export { DocumentServiceError } from "@/services/documents/errors"
export {
  archiveDocument,
  completeDocumentUpload,
  createDocumentDownloadUrl,
  createDocumentReplacementUploadUrl,
  createDocumentUploadUrl,
} from "@/services/documents/version-service"
export {
  createFolder,
  getDocumentDetail,
  listDocumentWorkspace,
} from "@/services/documents/workspace-service"
export {
  archiveFolder,
  restoreDocument,
  restoreFolder,
  trashDocument,
  trashFolder,
} from "@/services/documents/lifecycle-service"
export {
  processDueResourcePurges,
  requestDocumentPurge,
  requestFolderPurge,
} from "@/services/documents/purge-service"
