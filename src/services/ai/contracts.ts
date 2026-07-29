/** Validated provider key carried through the provider-neutral core port. */
export type AiProviderId = string

/** Exact provider and model pair used for one AI request. */
export type AiModelReference = {
  provider: AiProviderId
  model: string
}

/** JSON Schema subset accepted by structured-output provider adapters. */
export type AiJsonSchema = Record<string, unknown>

/** Token usage reported by an AI provider, or null when it was omitted. */
export type AiTokenUsage = {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

/** Provider-neutral request for schema-constrained text generation. */
export type AiStructuredGenerationRequest = {
  model: AiModelReference
  input: string
  systemInstruction: string
  responseSchema: AiJsonSchema
  maxOutputTokens: number
  traceId: string
}

/** Provider-neutral result for one schema-constrained upstream call. */
export type AiStructuredGenerationResult = {
  model: AiModelReference
  text: string
  traceId: string
  upstreamCalls: number
  usage: AiTokenUsage
}

/** Small provider interface consumed by application services. */
export interface AiProvider {
  readonly id: AiProviderId

  /**
   * Generates text constrained by the supplied JSON Schema.
   *
   * @param request - Exact model, prompt, schema, limits, and trace context.
   * @returns Provider text, usage, trace identifier, and upstream call count.
   * @throws AiProviderError when the upstream request cannot be completed.
   */
  generateStructured(
    request: AiStructuredGenerationRequest
  ): Promise<AiStructuredGenerationResult>
}

/** Configured provider port and exact model selected at the infrastructure edge. */
export type AiRuntime = {
  provider: AiProvider
  model: AiModelReference
}
