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
export { changeDocumentTemplates } from "./templates/template-bulk-service"
export {
  archiveDocumentTemplate,
  createDocumentTemplate,
  duplicateDocumentTemplate,
  getDocumentTemplate,
  getDocumentTemplateVersion,
  listDocumentTemplateCategories,
  listDocumentTemplates,
  listDocumentTemplateVersions,
  publishDocumentTemplate,
  restoreDocumentTemplate,
  setDocumentTemplateCategory,
  updateDocumentTemplate,
} from "./templates/template-lifecycle-service"
export { listTemplatePage } from "./templates/template-list-service"
