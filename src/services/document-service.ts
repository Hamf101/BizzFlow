export type {
  CreateDocumentReplacementUploadUrlInput,
  CreateDocumentUploadUrlInput,
  DocumentServiceDeps,
} from "@/services/documents/contracts"
export type { DocumentCard } from "@/services/documents/card-service"
export { listDocumentCards } from "@/services/documents/card-service"
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
  listFolderDocuments,
  listRecentDocuments,
  listWorkspaceFolders,
} from "@/services/documents/workspace-service"
export {
  archiveFolder,
  restoreDocument,
  restoreFolder,
  trashDocument,
  trashFolder,
} from "@/services/documents/lifecycle-service"
export { moveDocument, moveFolder } from "@/services/documents/move-service"
export {
  processDueResourcePurges,
  requestDocumentPurge,
  requestFolderPurge,
} from "@/services/documents/purge-service"
export type {
  SharingGrant,
  SharingPerson,
  SharingResource,
  SharingView,
} from "@/services/documents/sharing-contracts"
export {
  getSharingMany,
  setSharingAccessMany,
  setSharingInheritanceMany,
} from "@/services/documents/sharing-many"
