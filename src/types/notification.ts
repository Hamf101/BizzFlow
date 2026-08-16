import { z } from "zod"

/** Channels a notification can be delivered through. */
export const NOTIFICATION_CHANNELS = ["email", "sms"] as const

/**
 * Outcome of one delivery attempt.
 *
 * `suppressed` is distinct from `sent` on purpose: a notification that a
 * preference silenced was never handed to a provider, and recording it as sent
 * would make the delivery history lie about what reached the recipient.
 */
export const NOTIFICATION_DELIVERY_STATUSES = [
  "sent",
  "failed",
  "suppressed",
] as const

/** Why a notification was sent, used for operator-facing grouping. */
export const NOTIFICATION_PURPOSES = [
  "task_assigned",
  "task_reminder",
  "document_signing",
  "organization_invite",
] as const

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]
export type NotificationDeliveryStatus =
  (typeof NOTIFICATION_DELIVERY_STATUSES)[number]
export type NotificationPurpose = (typeof NOTIFICATION_PURPOSES)[number]

export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS)
export const notificationDeliveryStatusSchema = z.enum(
  NOTIFICATION_DELIVERY_STATUSES
)
export const notificationPurposeSchema = z.enum(NOTIFICATION_PURPOSES)

const timestampSchema = z.string().datetime({ offset: true })

const notificationDeliveryRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  recipient_user_id: z.string().uuid().nullable(),
  channel: notificationChannelSchema,
  purpose: notificationPurposeSchema,
  reference: z.string(),
  status: notificationDeliveryStatusSchema,
  attempt_count: z.number().int().nonnegative(),
  last_error: z.string().nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
})

/** One recorded notification delivery attempt. */
export type NotificationDelivery = {
  id: string
  organizationId: string
  recipientUserId: string | null
  channel: NotificationChannel
  purpose: NotificationPurpose
  reference: string
  status: NotificationDeliveryStatus
  attemptCount: number
  lastError: string | null
  createdAt: string
  updatedAt: string
}

/** Error raised when notification data violates the domain contract. */
export class NotificationDomainError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "NotificationDomainError"
    this.statusCode = statusCode
  }
}

/**
 * Parses an unknown database row into a typed notification delivery.
 *
 * @param value - Untrusted persistence data.
 * @returns Canonical camel-case delivery data.
 * @throws NotificationDomainError when the row violates the contract.
 */
export function parseNotificationDeliveryRow(
  value: unknown
): NotificationDelivery {
  const result = notificationDeliveryRowSchema.safeParse(value)

  if (!result.success) {
    throw new NotificationDomainError(
      "Database returned an invalid notification delivery record.",
      500
    )
  }

  const row = result.data

  return {
    id: row.id,
    organizationId: row.org_id,
    recipientUserId: row.recipient_user_id,
    channel: row.channel,
    purpose: row.purpose,
    reference: row.reference,
    status: row.status,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Resolves whether a channel may actually be used for a recipient.
 *
 * The organization switch gates the member preference rather than merging with
 * it: an organization that turned a channel off must not be overridden by an
 * individual's setting.
 *
 * @param input - Organization and member switches for one channel.
 * @returns True only when both levels permit the channel.
 */
export function isNotificationChannelEnabled(input: {
  organizationEnabled: boolean
  memberEnabled: boolean
}): boolean {
  return input.organizationEnabled && input.memberEnabled
}
