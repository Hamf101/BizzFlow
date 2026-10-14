import { ServiceError } from "@/services/service-error"

/** Error raised by sheet service operations. */
export class SheetServiceError extends ServiceError {
  override readonly name = "SheetServiceError"
}
