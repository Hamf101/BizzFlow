/**
 * Backward-compatible public facade for generated-document signing workflows.
 *
 * Keep application imports pointed at this module while cohesive implementation
 * details remain isolated under `services/document-signing/`.
 */
export { DocumentSigningServiceError } from "@/services/document-signing/errors"
export {
  completePublicDocumentSigning,
  getGeneratedDocumentSigningView,
  getPublicDocumentSigningView,
  resendDocumentSigningInvitation,
  saveGeneratedDocumentAnswers,
  sendDocumentForSigning,
  updateGeneratedDocumentContent,
} from "@/services/document-signing/workflows"
