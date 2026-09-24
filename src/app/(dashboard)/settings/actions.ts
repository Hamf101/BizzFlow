"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import {
  ORGANIZATION_PERMISSION_ACTIONS,
  type OrganizationPermissionAction,
} from "@/lib/permissions"
import {
  buildFeedbackRedirect,
  getActionErrorFeedbackCode,
} from "@/lib/action-result"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import {
  updateOrganizationNotificationSettings,
} from "@/services/notification-service"
import {
  archiveOrganizationRole,
  createOrganizationRole,
  OrganizationServiceError,
  updateOrganizationRole,
  updateProfile,
  updateNotificationPreferences,
} from "@/services/organization-service"

const SETTINGS_ACCESS_PATH = "/settings#roles-and-access"
const permissionSchema = z.enum(ORGANIZATION_PERMISSION_ACTIONS)
const roleNameSchema = z.string().min(2).max(60).trim()
const roleMutationSchema = z.object({
  organizationId: z.string().uuid(),
  name: roleNameSchema,
  permissions: z.array(permissionSchema),
})
const roleUpdateSchema = roleMutationSchema.extend({
  roleId: z.string().uuid(),
  permissionsLocked: z.boolean(),
})
const roleArchiveSchema = z.object({
  organizationId: z.string().uuid(),
  roleId: z.string().uuid(),
})

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
    redirect(buildFeedbackRedirect("/settings", "invalid_input"))
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
      buildFeedbackRedirect("/settings", getActionErrorFeedbackCode(error))
    )
  }

  revalidatePath("/settings")
  redirect(buildFeedbackRedirect("/settings", "changes_saved"))
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
    redirect(buildFeedbackRedirect("/settings", "invalid_input"))
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
      buildFeedbackRedirect("/settings", getActionErrorFeedbackCode(error))
    )
  }

  revalidatePath("/settings")
  redirect(buildFeedbackRedirect("/settings", "changes_saved"))
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
 * `organization:manage` permission, granted by default only to Owner.
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
    redirect(buildFeedbackRedirect("/settings", "invalid_input"))
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
      buildFeedbackRedirect("/settings", getActionErrorFeedbackCode(error))
    )
  }

  revalidatePath("/settings")
  redirect(buildFeedbackRedirect("/settings", "changes_saved"))
}

/**
 * Creates a workspace-scoped custom role from selected permission outcomes.
 *
 * @param formData - Tenant, visible role name, and repeated permission fields.
 * @returns Never returns; redirects to the access section with feedback.
 */
export async function createOrganizationRoleAction(
  formData: FormData
): Promise<void> {
  const parsed = roleMutationSchema.safeParse({
    organizationId: getFormString(formData, "organizationId"),
    name: getFormString(formData, "name"),
    permissions: getPermissionValues(formData),
  })

  if (!parsed.success) {
    redirect(buildFeedbackRedirect(SETTINGS_ACCESS_PATH, "invalid_input"))
  }

  await runAuthenticatedSettingsMutation(async (actorUserId: string) => {
    await createOrganizationRole({
      actorUserId,
      organizationId: parsed.data.organizationId,
      name: parsed.data.name,
      permissions: parsed.data.permissions,
    })
  })

  revalidatePath("/settings")
  revalidatePath("/people")
  redirect(buildFeedbackRedirect(SETTINGS_ACCESS_PATH, "role_created"))
}

/**
 * Updates a role name and its editable permission set.
 *
 * Owner submits a locked marker so only its visible name is sent; the service
 * and database remain the authority that its full access cannot change.
 *
 * @param formData - Tenant, role, visible name, and repeated permission fields.
 * @returns Never returns; redirects to the access section with feedback.
 */
export async function updateOrganizationRoleAction(
  formData: FormData
): Promise<void> {
  const parsed = roleUpdateSchema.safeParse({
    organizationId: getFormString(formData, "organizationId"),
    roleId: getFormString(formData, "roleId"),
    name: getFormString(formData, "name"),
    permissions: getPermissionValues(formData),
    permissionsLocked: getFormString(formData, "permissionsLocked") === "true",
  })

  if (!parsed.success) {
    redirect(buildFeedbackRedirect(SETTINGS_ACCESS_PATH, "invalid_input"))
  }

  await runAuthenticatedSettingsMutation(async (actorUserId: string) => {
    await updateOrganizationRole({
      actorUserId,
      organizationId: parsed.data.organizationId,
      roleId: parsed.data.roleId,
      name: parsed.data.name,
      permissions: parsed.data.permissionsLocked
        ? undefined
        : parsed.data.permissions,
    })
  })

  revalidatePath("/settings")
  revalidatePath("/people")
  redirect(buildFeedbackRedirect(SETTINGS_ACCESS_PATH, "role_updated"))
}

/**
 * Archives an unused non-owner role while preserving audit history.
 *
 * @param formData - Tenant and role identifiers.
 * @returns Never returns; redirects to the access section with feedback.
 */
export async function archiveOrganizationRoleAction(
  formData: FormData
): Promise<void> {
  const parsed = roleArchiveSchema.safeParse({
    organizationId: getFormString(formData, "organizationId"),
    roleId: getFormString(formData, "roleId"),
  })

  if (!parsed.success) {
    redirect(buildFeedbackRedirect(SETTINGS_ACCESS_PATH, "invalid_input"))
  }

  await runAuthenticatedSettingsMutation(
    async (actorUserId: string) => {
      await archiveOrganizationRole({
        actorUserId,
        organizationId: parsed.data.organizationId,
        roleId: parsed.data.roleId,
      })
    },
    "role_in_use"
  )

  revalidatePath("/settings")
  revalidatePath("/people")
  redirect(buildFeedbackRedirect(SETTINGS_ACCESS_PATH, "role_removed"))
}

function getPermissionValues(
  formData: FormData
): OrganizationPermissionAction[] {
  return formData
    .getAll("permissions")
    .filter((value): value is string => typeof value === "string")
    .filter((value): value is OrganizationPermissionAction =>
      ORGANIZATION_PERMISSION_ACTIONS.includes(
        value as OrganizationPermissionAction
      )
    )
}

async function runAuthenticatedSettingsMutation(
  operation: (actorUserId: string) => Promise<void>,
  conflictFeedbackCode?: "role_in_use"
): Promise<void> {
  try {
    const user = await getAuthenticatedUser()
    await operation(user.id)
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/settings" }))
    }

    const feedbackCode =
      conflictFeedbackCode &&
      error instanceof OrganizationServiceError &&
      error.statusCode === 409
        ? conflictFeedbackCode
        : getActionErrorFeedbackCode(error)

    redirect(buildFeedbackRedirect(SETTINGS_ACCESS_PATH, feedbackCode))
  }
}
