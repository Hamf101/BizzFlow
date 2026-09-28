export type {
  ChangeDocumentTemplateStatusInput,
  CreateDocumentTemplateInput,
  CreateGeneratedDocumentInput,
  DuplicateDocumentTemplateInput,
  GetDocumentTemplateInput,
  ListDocumentTemplatesInput,
  ListTemplatePageInput,
  PublishDocumentTemplateInput,
  RecordDocumentRecentAccessInput,
  TemplatePage,
  TemplateServiceDeps,
  UpdateDocumentTemplateInput,
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
