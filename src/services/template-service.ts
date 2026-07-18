export type {
  ChangeDocumentTemplateStatusInput,
  CreateDocumentTemplateInput,
  CreateGeneratedDocumentInput,
  GetDocumentTemplateInput,
  ListDocumentTemplatesInput,
  ListRecentDocumentsInput,
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
  getDocumentTemplate,
  listDocumentTemplates,
  publishDocumentTemplate,
  updateDocumentTemplate,
} from "./templates/template-lifecycle-service"
