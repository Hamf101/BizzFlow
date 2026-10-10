import { ServiceError } from "@/services/service-error"

/** Error raised by task and task-reminder service operations. */
export class TaskServiceError extends ServiceError {
  override readonly name = "TaskServiceError"
}
