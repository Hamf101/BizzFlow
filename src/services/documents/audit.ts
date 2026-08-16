import { recordAuditLog as defaultRecordAuditLog } from "@/services/audit-service"
import type {
  DocumentAuditLogInput,
  DocumentServiceDeps,
} from "@/services/documents/contracts"
import { DocumentServiceError } from "@/services/documents/errors"

/**
 * Records a best-effort audit event without failing the document operation.
 *
 * @param deps - Injected document service dependencies.
 * @param input - Audit event payload.
 */
export async function recordDocumentAuditLog(
  deps: DocumentServiceDeps,
  input: DocumentAuditLogInput
): Promise<void> {
  const recordAuditLog = deps.recordAuditLog ?? defaultRecordAuditLog

  try {
    await recordAuditLog(input)
  } catch (error: unknown) {
    console.warn("document_audit_log_failed", {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      reason: error instanceof Error ? error.message : "Unknown audit error",
    })
  }
}

/**
 * Records a required audit event and rejects the operation if recording fails.
 *
 * @param deps - Injected document service dependencies.
 * @param input - Audit event payload.
 * @throws DocumentServiceError when the audit event cannot be persisted.
 */
export async function recordRequiredDocumentAuditLog(
  deps: DocumentServiceDeps,
  input: DocumentAuditLogInput
): Promise<void> {
  const recordAuditLog = deps.recordAuditLog ?? defaultRecordAuditLog

  try {
    await recordAuditLog(input)
  } catch (error: unknown) {
    console.error("required_document_audit_log_failed", {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      targetId: input.targetId,
      reason: error instanceof Error ? error.message : "Unknown audit error",
    })
    throw new DocumentServiceError(
      "Unable to record the document download audit event.",
      500
    )
  }
}
