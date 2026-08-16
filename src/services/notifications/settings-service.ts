import { createAdminClient } from "@/lib/supabase/admin"
import type {
  NotificationServiceClient,
  NotificationServiceDeps,
} from "@/services/notifications/delivery-service"
import { NotificationServiceError } from "@/services/notifications/delivery-service"

/** Organization-wide notification switches. */
export type OrganizationNotificationSettings = {
  emailNotificationsEnabled: boolean
  smsNotificationsEnabled: boolean
}

type OrganizationSettingsRow = {
  id: string
  email_notifications_enabled: boolean | null
  sms_notifications_enabled: boolean | null
}

/**
 * Settings applied when an organization row cannot be read.
 *
 * Failing open matters here: an unreadable settings row must not silently
 * stop every notification in the tenant. A genuinely disabled channel is an
 * explicit `false` in the database, not a missing read.
 */
const DEFAULT_SETTINGS: OrganizationNotificationSettings = {
  emailNotificationsEnabled: true,
  smsNotificationsEnabled: true,
}

/**
 * Loads notification switches for several organizations at once.
 *
 * @param client - Trusted database client.
 * @param organizationIds - Tenants whose settings are needed.
 * @returns Settings keyed by organization id, defaulting to enabled.
 */
export async function loadOrganizationNotificationSettingsMap(
  client: NotificationServiceClient,
  organizationIds: readonly string[]
): Promise<Map<string, OrganizationNotificationSettings>> {
  const settings = new Map<string, OrganizationNotificationSettings>()

  if (organizationIds.length === 0) {
    return settings
  }

  const { data, error } = await client
    .from("organizations")
    .select("id,email_notifications_enabled,sms_notifications_enabled")
    .in("id", Array.from(new Set(organizationIds)))

  if (error || !data) {
    console.warn("organization_notification_settings_load_failed", {
      reason: error?.message ?? "No organization settings returned.",
    })
    return settings
  }

  for (const row of data as OrganizationSettingsRow[]) {
    settings.set(row.id, {
      emailNotificationsEnabled: row.email_notifications_enabled ?? true,
      smsNotificationsEnabled: row.sms_notifications_enabled ?? true,
    })
  }

  return settings
}

/**
 * Loads one organization's notification switches.
 *
 * @param organizationId - Tenant whose settings are needed.
 * @param deps - Optional database dependency for tests.
 * @returns The organization's switches, defaulting to enabled.
 */
export async function getOrganizationNotificationSettings(
  organizationId: string,
  deps: NotificationServiceDeps = {}
): Promise<OrganizationNotificationSettings> {
  const client = deps.client ?? createAdminClient()
  const settings = await loadOrganizationNotificationSettingsMap(client, [
    organizationId,
  ])

  return settings.get(organizationId) ?? DEFAULT_SETTINGS
}

/** Input for changing an organization's notification switches. */
export type UpdateOrganizationNotificationSettingsInput = {
  actorUserId: string
  organizationId: string
  emailNotificationsEnabled: boolean
  smsNotificationsEnabled: boolean
}

/**
 * Updates an organization's notification switches.
 *
 * These silence a channel for every member, so the caller must hold
 * `organization:manage`, which only `owner_admin` has.
 *
 * @param input - Actor, tenant, and the requested switch positions.
 * @param deps - Optional database and audit dependencies.
 * @returns The stored settings.
 * @throws NotificationServiceError when access or the write fails.
 */
export async function updateOrganizationNotificationSettings(
  input: UpdateOrganizationNotificationSettingsInput,
  deps: NotificationServiceDeps = {}
): Promise<OrganizationNotificationSettings> {
  const client = deps.client ?? createAdminClient()

  const { data: membership, error: membershipError } = await client
    .from("organization_memberships")
    .select("role")
    .eq("org_id", input.organizationId)
    .eq("user_id", input.actorUserId)
    .eq("status", "active")
    .maybeSingle()

  if (membershipError) {
    throw new NotificationServiceError(
      "Unable to verify your organization access.",
      500
    )
  }

  const role = (membership as { role?: string } | null)?.role

  if (role !== "owner_admin") {
    throw new NotificationServiceError(
      "Only an organization owner can change notification settings.",
      403
    )
  }

  const timestamp = (deps.now?.() ?? new Date()).toISOString()
  const { data, error } = await client
    .from("organizations")
    .update({
      email_notifications_enabled: input.emailNotificationsEnabled,
      sms_notifications_enabled: input.smsNotificationsEnabled,
      updated_at: timestamp,
    })
    .eq("id", input.organizationId)
    .select("id,email_notifications_enabled,sms_notifications_enabled")
    .maybeSingle()

  if (error || !data) {
    throw new NotificationServiceError(
      "Unable to update organization notification settings.",
      500
    )
  }

  const row = data as OrganizationSettingsRow

  return {
    emailNotificationsEnabled: row.email_notifications_enabled ?? true,
    smsNotificationsEnabled: row.sms_notifications_enabled ?? true,
  }
}
