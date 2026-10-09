import { randomUUID } from "node:crypto"

import { createAdminClient, type AdminSupabaseClient } from "@/lib/supabase/admin"
import { recordAuditLog, recordAuditLogBestEffort } from "@/services/audit-service"
import { requireOrgPermission } from "@/services/organizations/active-membership"
import type { AuditLogAction, AuditMetadata } from "@/types/audit"
import {
  parseNotificationDeliveryRow,
  parseNotificationDeliveryRows,
  type NotificationChannel,
  type NotificationDelivery,
  type NotificationDeliveryStatus,
  type NotificationPurpose,
} from "@/types/notification"
import { ServiceError } from "@/services/service-error"

/** Narrow trusted client used by notification persistence. */
export type NotificationServiceClient = Pick<AdminSupabaseClient, "from">

/** Audit payload written alongside a recorded delivery. */
export type NotificationAuditLogInput = {
  organizationId: string
  actorUserId: string | null
  action: AuditLogAction
  targetType: "notification"
  targetId: string
  metadata: AuditMetadata
}

export type NotificationServiceDeps = {
  client?: NotificationServiceClient
  createId?: () => string
  now?: () => Date
  recordAuditLog?: (input: NotificationAuditLogInput) => Promise<unknown>
}

/** One delivery attempt to record. */
export type RecordNotificationDeliveryInput = {
  organizationId: string
  recipientUserId: string | null
  channel: NotificationChannel
  purpose: NotificationPurpose
  reference: string
  status: NotificationDeliveryStatus
  attemptCount?: number
  lastError?: string | null
}

/** Error raised by notification delivery persistence. */
export class NotificationServiceError extends ServiceError {
  override readonly name = "NotificationServiceError"
}

const DELIVERY_COLUMNS =
  "id,org_id,recipient_user_id,channel,purpose,reference,status,attempt_count,last_error,created_at,updated_at"

/** Longest failure reason the column accepts. */
const MAX_ERROR_LENGTH = 500

const AUDIT_ACTION_BY_STATUS: Record<NotificationDeliveryStatus, AuditLogAction> =
  {
    sent: "notification.sent",
    failed: "notification.failed",
    suppressed: "notification.suppressed",
  }

/**
 * Records one notification delivery attempt and its audit event.
 *
 * This is the only place a notification outcome becomes durable. It is
 * deliberately forgiving: a notification that was genuinely sent must not be
 * reported as failed because the bookkeeping write failed afterwards, so
 * persistence problems are logged and swallowed rather than thrown.
 *
 * No message body, phone number, or email address is stored — the recipient is
 * referenced by user id and the content by its purpose.
 *
 * @param input - Tenant, recipient, channel, purpose, and outcome.
 * @param deps - Optional database, identifier, clock, and audit dependencies.
 * @returns The recorded delivery, or null when it could not be persisted.
 */
export async function recordNotificationDelivery(
  input: RecordNotificationDeliveryInput,
  deps: NotificationServiceDeps = {}
): Promise<NotificationDelivery | null> {
  const client = deps.client ?? createAdminClient()
  const timestamp = (deps.now?.() ?? new Date()).toISOString()

  // The check constraint requires a reason for a failure and none for a
  // suppression, so normalise before writing rather than letting the database
  // reject an otherwise-correct record.
  const lastError =
    input.status === "failed"
      ? (input.lastError ?? "Notification delivery failed.").slice(
          0,
          MAX_ERROR_LENGTH
        )
      : null

  try {
    const { data, error } = await client
      .from("notification_deliveries")
      .insert({
        id: deps.createId?.() ?? randomUUID(),
        org_id: input.organizationId,
        recipient_user_id: input.recipientUserId,
        channel: input.channel,
        purpose: input.purpose,
        reference: input.reference,
        status: input.status,
        attempt_count: input.attemptCount ?? 1,
        last_error: lastError,
        created_at: timestamp,
        updated_at: timestamp,
      } as never)
      .select(DELIVERY_COLUMNS)
      .maybeSingle()

    if (error || !data) {
      console.warn("notification_delivery_record_failed", {
        organizationId: input.organizationId,
        channel: input.channel,
        purpose: input.purpose,
        status: input.status,
        reason: error?.message ?? "No delivery row returned.",
      })
      return null
    }

    const delivery = parseNotificationDeliveryRow(data)

    await recordDeliveryAuditLog(deps, delivery)

    return delivery
  } catch (error: unknown) {
    console.warn("notification_delivery_record_failed", {
      organizationId: input.organizationId,
      channel: input.channel,
      purpose: input.purpose,
      status: input.status,
      reason: error instanceof Error ? error.message : "Unknown persistence error",
    })
    return null
  }
}

/** A member acting on one organization's notification setup. */
export type NotificationActorInput = {
  actorUserId: string
  organizationId: string
}

/**
 * Refuses anyone without `organization:manage`: notification switches and
 * delivery history are organization administration.
 *
 * @param client - Trusted database client.
 * @param input - Actor and tenant.
 * @throws NotificationServiceError 403 without the permission, 500 when the read fails.
 */
export async function requireNotificationAdmin(
  client: NotificationServiceClient,
  input: NotificationActorInput
): Promise<void> {
  await requireOrgPermission(client, input.organizationId, input.actorUserId, "organization:manage", {
    loadFailed: () => new NotificationServiceError("Unable to verify your organization access.", 500),
    denied: () => new NotificationServiceError("You do not have permission to manage organization notifications.", 403),
  })
}

/** Input for reading a tenant's recent delivery history. */
export type ListNotificationDeliveriesInput = NotificationActorInput & {
  limit?: number
}

/** Largest page the delivery history will return. */
const MAX_DELIVERY_PAGE = 200

/**
 * Lists a tenant's most recent notification delivery attempts.
 *
 * @param input - Actor, tenant, and optional page size.
 * @param deps - Optional database dependency for tests.
 * @returns Deliveries newest first.
 * @throws NotificationServiceError without organization:manage or when the read fails.
 */
export async function listNotificationDeliveries(
  input: ListNotificationDeliveriesInput,
  deps: NotificationServiceDeps = {}
): Promise<NotificationDelivery[]> {
  const client = deps.client ?? createAdminClient()
  await requireNotificationAdmin(client, input)
  const limit = Math.min(Math.max(input.limit ?? 50, 1), MAX_DELIVERY_PAGE)

  const { data, error } = await client
    .from("notification_deliveries")
    .select(DELIVERY_COLUMNS)
    .eq("org_id", input.organizationId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error || !data) {
    throw new NotificationServiceError(
      "Unable to load notification history.",
      500
    )
  }

  return parseNotificationDeliveryRows(data)
}

/**
 * Records the audit event for one delivery attempt, best effort.
 *
 * Defaults to the real recorder, matching `recordTaskAuditLog`
 * (`src/services/tasks/shared.ts:606`). The previous `if (deps.recordAuditLog)`
 * guard had no fallback and every production caller passes no deps, so
 * `notification.sent` / `.failed` / `.suppressed` never reached the audit log —
 * only tests, which inject a fake, ever saw one.
 *
 * A failed audit write must not discard a delivery row that was written, so
 * this logs and returns rather than throwing.
 *
 * @param deps - Injected notification service dependencies.
 * @param delivery - The delivery attempt just persisted.
 */
async function recordDeliveryAuditLog(
  deps: NotificationServiceDeps,
  delivery: NotificationDelivery
): Promise<void> {
  await recordAuditLogBestEffort(
    {
      organizationId: delivery.organizationId,
      // A notification is emitted by a background job, not a member.
      actorUserId: null,
      action: AUDIT_ACTION_BY_STATUS[delivery.status],
      targetType: "notification",
      targetId: delivery.id,
      metadata: {
        channel: delivery.channel,
        purpose: delivery.purpose,
        recipientUserId: delivery.recipientUserId,
        attemptCount: delivery.attemptCount,
      },
    },
    deps.recordAuditLog ?? recordAuditLog
  )
}
