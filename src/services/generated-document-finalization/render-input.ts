import { createHash } from "node:crypto"

import type { RenderGeneratedDocumentPdfInput } from "@/services/document-pdf-service"
import type { DocumentSigningRecipient } from "@/types/signing"
import type { GeneratedDocumentSigningView } from "@/types/signing"

import { GeneratedDocumentFinalizationServiceError } from "./errors"

/** Canonical render input paired with the SHA-256 stored by the state machine. */
export type CanonicalFinalizationRenderInput = {
  input: RenderGeneratedDocumentPdfInput
  sha256: string
}

/**
 * Builds and freezes the complete document-derived PDF renderer input.
 *
 * Recipients retain invitation order, with their immutable identifier as a
 * tie-breaker, so database delivery order cannot change the rendered bytes.
 *
 * @param view - Completed, tenant-scoped generated signing view.
 * @returns A JSON-round-tripped render input and its canonical SHA-256.
 * @throws GeneratedDocumentFinalizationServiceError for unsupported JSON data.
 */
export function buildCanonicalFinalizationRenderInput(
  view: GeneratedDocumentSigningView
): CanonicalFinalizationRenderInput {
  const recipients = [...view.recipients].sort(compareRecipients)
  const renderInput: RenderGeneratedDocumentPdfInput = {
    documentId: view.document.id,
    title: view.document.title,
    content: view.document.templateSnapshot,
    answers: view.answers,
    workflowStatus: view.workflowStatus,
    signers: recipients.map((recipient: DocumentSigningRecipient) => ({
      id: recipient.id,
      name: recipient.name,
      email: recipient.email,
      requiresSignature: recipient.requiresSignature,
      status: recipient.status,
      signedAt: recipient.signedAt,
      signatureDataUrl: recipient.signatureDataUrl,
      initialsDataUrl: recipient.initialsDataUrl,
    })),
  }
  const canonicalJson = canonicalizeJson(renderInput)

  return {
    input: JSON.parse(canonicalJson) as RenderGeneratedDocumentPdfInput,
    sha256: createHash("sha256").update(canonicalJson).digest("hex"),
  }
}

/**
 * Serializes JSON-compatible data with recursively sorted object keys.
 *
 * @param value - JSON-compatible value to serialize deterministically.
 * @returns Canonical compact JSON.
 * @throws GeneratedDocumentFinalizationServiceError for non-JSON values.
 */
export function canonicalizeJson(value: unknown): string {
  try {
    return serializeCanonicalJson(value, new Set<object>())
  } catch (error: unknown) {
    if (error instanceof GeneratedDocumentFinalizationServiceError) {
      throw error
    }

    throw new GeneratedDocumentFinalizationServiceError(
      "Generated document render input is invalid.",
      500
    )
  }
}

function compareRecipients(
  left: DocumentSigningRecipient,
  right: DocumentSigningRecipient
): number {
  return (
    left.invitedAt.localeCompare(right.invitedAt) ||
    left.id.localeCompare(right.id)
  )
}

function serializeCanonicalJson(
  value: unknown,
  ancestors: Set<object>
): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value)
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throwInvalidRenderInput()
    }

    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    assertNotCircular(value, ancestors)
    const serialized = value.map((item: unknown): string =>
      serializeCanonicalJson(item, ancestors)
    )
    ancestors.delete(value)
    return `[${serialized.join(",")}]`
  }

  if (typeof value === "object") {
    assertNotCircular(value, ancestors)
    const prototype = Object.getPrototypeOf(value)

    if (prototype !== Object.prototype && prototype !== null) {
      throwInvalidRenderInput()
    }

    const record = value as Record<string, unknown>
    const serialized = Object.keys(record)
      .sort()
      .map(
        (key: string): string =>
          `${JSON.stringify(key)}:${serializeCanonicalJson(
            record[key],
            ancestors
          )}`
      )
    ancestors.delete(value)
    return `{${serialized.join(",")}}`
  }

  throwInvalidRenderInput()
}

function assertNotCircular(value: object, ancestors: Set<object>): void {
  if (ancestors.has(value)) {
    throwInvalidRenderInput()
  }

  ancestors.add(value)
}

function throwInvalidRenderInput(): never {
  throw new GeneratedDocumentFinalizationServiceError(
    "Generated document render input is invalid.",
    500
  )
}
