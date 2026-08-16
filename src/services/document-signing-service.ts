/**
 * Backward-compatible public facade for generated-document signing workflows.
 *
 * Keep application imports pointed at this module while cohesive implementation
 * details remain isolated under `services/document-signing/`.
 */
export type {
  CompletePublicDocumentSigningInput,
  DocumentSigningServiceDeps,
  GetGeneratedDocumentSigningViewInput,
  GetPublicDocumentSigningViewInput,
  ResendDocumentSigningInvitationInput,
  SaveGeneratedDocumentAnswersInput,
  SendDocumentForSigningInput,
} from "@/services/document-signing/contracts"
export { DocumentSigningServiceError } from "@/services/document-signing/errors"
export {
  completePublicDocumentSigning,
  getGeneratedDocumentSigningView,
  getPublicDocumentSigningView,
  resendDocumentSigningInvitation,
  saveGeneratedDocumentAnswers,
  sendDocumentForSigning,
} from "@/services/document-signing/workflows"
