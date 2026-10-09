/**
 * HTTP-translatable service error. Each domain subclasses it under its own
 * `name`, so route mappers keep matching on the domain class with `instanceof`.
 */
export class ServiceError extends Error {
  readonly statusCode: number

  /**
   * @param message - User-safe error message, surfaced at the route boundary.
   * @param statusCode - HTTP-style status code for route/action translation.
   * @param options - Optional original error, kept for server-side logs only.
   */
  constructor(message: string, statusCode: number, options?: ErrorOptions) {
    super(message, options)
    this.statusCode = statusCode
  }
}
