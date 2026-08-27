export type {
  ChangeDocumentTemplateStatusInput,
  CreateDocumentTemplateInput,
  CreateGeneratedDocumentInput,
  DuplicateDocumentTemplateInput,
  GetDocumentTemplateInput,
  ListDocumentTemplatesInput,
  ListRecentDocumentsInput,
  PublishDocumentTemplateInput,
  RecordDocumentRecentAccessInput,
  TemplateServiceDeps,
  UpdateDocumentTemplateInput,
} from "./templates/contracts"
export { TemplateServiceError } from "./templates/errors"
export {
  createGeneratedDocument,
  listRecentDocuments,
  recordDocumentRecentAccess,
} from "./templates/generated-document-service"
export {
  archiveDocumentTemplate,
  createDocumentTemplate,
  duplicateDocumentTemplate,
  getDocumentTemplate,
  listDocumentTemplateCategories,
  listDocumentTemplates,
  publishDocumentTemplate,
  updateDocumentTemplate,
} from "./templates/template-lifecycle-service"
