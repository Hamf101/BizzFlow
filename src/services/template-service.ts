export type {
  ListTemplatePageInput,
  TemplatePage,
} from "./templates/contracts"
export { TemplateServiceError } from "./templates/errors"
export {
  createGeneratedDocument,
  recordDocumentRecentAccess,
} from "./templates/generated-document-service"
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
  updateDocumentTemplate,
} from "./templates/template-lifecycle-service"
export { listTemplatePage } from "./templates/template-list-service"
