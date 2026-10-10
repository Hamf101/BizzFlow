import { ServiceError } from "@/services/service-error"

/** User-safe failure raised by immutable generated-document finalization. */
export class GeneratedDocumentFinalizationServiceError extends ServiceError {
  override readonly name = "GeneratedDocumentFinalizationServiceError"
}
