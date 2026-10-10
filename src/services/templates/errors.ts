import { ServiceError } from "@/services/service-error"

/** Error raised by template and generated-document domain operations. */
export class TemplateServiceError extends ServiceError {
  override readonly name = "TemplateServiceError"
}
