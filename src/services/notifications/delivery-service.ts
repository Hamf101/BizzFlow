import { randomUUID } from "node:crypto"

import { createAdminClient, type AdminSupabaseClient } from "@/lib/supabase/admin"
import type { AuditLogAction, AuditMetadata } from "@/types/audit"
import {
  parseNotificationDeliveryRow,
  type NotificationChannel,
  type NotificationDelivery,
  type NotificationDeliveryStatus,
  type NotificationPurpose,
} from "@/types/notification"

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
export class NotificationServiceError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "NotificationServiceError"
    this.statusCode = statusCode
  }
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

    if (deps.recordAuditLog) {
      await deps.recordAuditLog({
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
      })
    }

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

/** Input for reading a tenant's recent delivery history. */
export type ListNotificationDeliveriesInput = {
  organizationId: string
  limit?: number
}

/** Largest page the delivery history will return. */
const MAX_DELIVERY_PAGE = 200

/**
 * Lists a tenant's most recent notification delivery attempts.
 *
 * @param input - Tenant identifier and optional page size.
 * @param deps - Optional database dependency for tests.
 * @returns Deliveries newest first.
 * @throws NotificationServiceError when the read fails.
 */
export async function listNotificationDeliveries(
  input: ListNotificationDeliveriesInput,
  deps: NotificationServiceDeps = {}
): Promise<NotificationDelivery[]> {
  const client = deps.client ?? createAdminClient()
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

  return data.map(parseNotificationDeliveryRow)
}
