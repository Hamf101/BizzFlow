export type {
  ChangeDocumentTemplatesResult as TemplateBulkResult,
  ListTemplatePageInput,
  TemplatePage,
} from "./templates/contracts"
export { MAX_BULK_TEMPLATES } from "./templates/contracts"
export { TemplateServiceError } from "./templates/errors"
export {
  createGeneratedDocument,
  recordDocumentRecentAccess,
} from "./templates/generated-document-service"
export { createDocumentCopy, createFilledTemplateCopy } from "./templates/filled-copy-service"
export { changeDocumentTemplates } from "./templates/template-bulk-service"
export {
  archiveDocumentTemplate,
  canEditDocumentTemplate,
  createDocumentTemplate,
  duplicateDocumentTemplate,
  getDocumentTemplate,
  getDocumentTemplateVersion,
  listDocumentTemplateCategories,
  listDocumentTemplates,
  listDocumentTemplateVersions,
  publishDocumentTemplate,
  purgeDueTrashedTemplates,
  purgeTrashedDocumentTemplate,
  updateDocumentTemplate,
} from "./templates/template-lifecycle-service"
export { listTemplatePage } from "./templates/template-list-service"
