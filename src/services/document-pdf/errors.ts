import { ServiceError } from "@/services/service-error"

/** Error raised when a generated document cannot be rendered as a PDF. */
export class DocumentPdfServiceError extends ServiceError {
  override readonly name = "DocumentPdfServiceError"
}
