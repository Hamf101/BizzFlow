/** Error raised by task and task-reminder service operations. */
export class TaskServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates an HTTP-translatable service error.
   *
   * @param message - User-safe rejection description.
   * @param statusCode - HTTP-style response status.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "TaskServiceError"
    this.statusCode = statusCode
  }
}
