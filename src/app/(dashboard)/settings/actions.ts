"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import {
  NotificationServiceError,
  updateOrganizationNotificationSettings,
} from "@/services/notification-service"
import {
  OrganizationServiceError,
  updateProfile,
  updateNotificationPreferences,
} from "@/services/organization-service"

const updateProfileSchema = z.object({
  displayName: z.string().min(1, "Display name is required.").max(200).trim(),
  phoneNumber: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, "Phone number must be in E.164 format (e.g. +2348001234567).")
    .nullable(),
})

const updatePreferencesSchema = z.object({
  organizationId: z.string().uuid("Organization ID is required."),
  emailNotificationsEnabled: z.boolean(),
  smsNotificationsEnabled: z.boolean(),
})

/**
 * Updates the current user's profile (display name and phone number).
 *
 * @param formData - Form containing displayName and phoneNumber fields.
 */
export async function updateProfileAction(formData: FormData): Promise<void> {
  const rawDisplayName = getFormString(formData, "displayName")
  const rawPhoneNumber = getFormString(formData, "phoneNumber")

  const parsed = updateProfileSchema.safeParse({
    displayName: rawDisplayName,
    phoneNumber: rawPhoneNumber === "" ? null : rawPhoneNumber,
  })

  if (!parsed.success) {
    redirect(
      buildRedirect("/settings", {
        error: parsed.error.issues[0]?.message ?? "Invalid profile input.",
      })
    )
  }

  try {
    const user = await getAuthenticatedUser()
    await updateProfile({
      actorUserId: user.id,
      displayName: parsed.data.displayName,
      phoneNumber: parsed.data.phoneNumber,
    })
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/settings" }))
    }

    redirect(
      buildRedirect("/settings", {
        error: error instanceof OrganizationServiceError ? error.message : "Unable to update profile.",
      })
    )
  }

  revalidatePath("/settings")
  redirect(buildRedirect("/settings", { message: "Profile updated." }))
}

/**
 * Updates notification preferences (email/SMS toggles) for the current
 * user's membership in their active organization.
 *
 * @param formData - Form containing organizationId, emailNotificationsEnabled, smsNotificationsEnabled.
 */
export async function updateNotificationPreferencesAction(formData: FormData): Promise<void> {
  const parsed = updatePreferencesSchema.safeParse({
    organizationId: getFormString(formData, "organizationId"),
    emailNotificationsEnabled: formData.get("emailNotificationsEnabled") === "on",
    smsNotificationsEnabled: formData.get("smsNotificationsEnabled") === "on",
  })

  if (!parsed.success) {
    redirect(
      buildRedirect("/settings", {
        error: parsed.error.issues[0]?.message ?? "Invalid preferences input.",
      })
    )
  }

  try {
    const user = await getAuthenticatedUser()
    await updateNotificationPreferences({
      actorUserId: user.id,
      organizationId: parsed.data.organizationId,
      emailNotificationsEnabled: parsed.data.emailNotificationsEnabled,
      smsNotificationsEnabled: parsed.data.smsNotificationsEnabled,
    })
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/settings" }))
    }

    redirect(
      buildRedirect("/settings", {
        error: error instanceof OrganizationServiceError ? error.message : "Unable to update preferences.",
      })
    )
  }

  revalidatePath("/settings")
  redirect(buildRedirect("/settings", { message: "Notification preferences updated." }))
}

const updateOrganizationSettingsSchema = z.object({
  organizationId: z.string().uuid("Organization ID is required."),
  emailNotificationsEnabled: z.boolean(),
  smsNotificationsEnabled: z.boolean(),
})

/**
 * Updates the organization-wide notification switches.
 *
 * These silence a channel for every member, so the service requires the
 * `organization:manage` permission that only an owner holds.
 *
 * @param formData - Organization id and the two channel switches.
 */
export async function updateOrganizationNotificationSettingsAction(
  formData: FormData
): Promise<void> {
  const parsed = updateOrganizationSettingsSchema.safeParse({
    organizationId: getFormString(formData, "organizationId"),
    emailNotificationsEnabled:
      formData.get("orgEmailNotificationsEnabled") === "on",
    smsNotificationsEnabled: formData.get("orgSmsNotificationsEnabled") === "on",
  })

  if (!parsed.success) {
    redirect(
      buildRedirect("/settings", {
        error: parsed.error.issues[0]?.message ?? "Invalid settings input.",
      })
    )
  }

  try {
    const user = await getAuthenticatedUser()
    await updateOrganizationNotificationSettings({
      actorUserId: user.id,
      organizationId: parsed.data.organizationId,
      emailNotificationsEnabled: parsed.data.emailNotificationsEnabled,
      smsNotificationsEnabled: parsed.data.smsNotificationsEnabled,
    })
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/settings" }))
    }

    redirect(
      buildRedirect("/settings", {
        error:
          error instanceof NotificationServiceError
            ? error.message
            : "Unable to update organization notification settings.",
      })
    )
  }

  revalidatePath("/settings")
  redirect(
    buildRedirect("/settings", {
      message: "Organization notification settings updated.",
    })
  )
}
