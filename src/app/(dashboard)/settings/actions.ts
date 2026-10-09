"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { getAuthenticatedUser } from "@/lib/auth"
import {
  ORGANIZATION_PERMISSION_ACTIONS,
  type OrganizationPermissionAction,
} from "@/lib/permissions"
import {
  buildFeedbackRedirect,
  type ActionFeedbackCode,
} from "@/lib/action-result"
import { runFormAction } from "@/lib/form-action"
import { getFormString } from "@/lib/form-utils"
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
import { profileSchema } from "@/types/profile"

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
  const parsed = profileSchema.safeParse({
    displayName: getFormString(formData, "displayName"),
    phoneNumber: getFormString(formData, "phoneNumber"),
  })

  if (!parsed.success) {
    redirect(buildFeedbackRedirect("/settings", "invalid_input"))
  }

  await runSettingsAction("/settings", "changes_saved", (actorUserId) =>
    updateProfile({
      actorUserId,
      displayName: parsed.data.displayName,
      phoneNumber: parsed.data.phoneNumber,
    })
  )
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

  await runSettingsAction("/settings", "changes_saved", (actorUserId) =>
    updateNotificationPreferences({
      actorUserId,
      organizationId: parsed.data.organizationId,
      emailNotificationsEnabled: parsed.data.emailNotificationsEnabled,
      smsNotificationsEnabled: parsed.data.smsNotificationsEnabled,
    })
  )
}

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
  const parsed = updatePreferencesSchema.safeParse({
    organizationId: getFormString(formData, "organizationId"),
    emailNotificationsEnabled:
      formData.get("orgEmailNotificationsEnabled") === "on",
    smsNotificationsEnabled: formData.get("orgSmsNotificationsEnabled") === "on",
  })

  if (!parsed.success) {
    redirect(buildFeedbackRedirect("/settings", "invalid_input"))
  }

  await runSettingsAction("/settings", "changes_saved", (actorUserId) =>
    updateOrganizationNotificationSettings({
      actorUserId,
      organizationId: parsed.data.organizationId,
      emailNotificationsEnabled: parsed.data.emailNotificationsEnabled,
      smsNotificationsEnabled: parsed.data.smsNotificationsEnabled,
    })
  )
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

  await runSettingsAction(
    SETTINGS_ACCESS_PATH,
    "role_created",
    (actorUserId) =>
      createOrganizationRole({
        actorUserId,
        organizationId: parsed.data.organizationId,
        name: parsed.data.name,
        permissions: parsed.data.permissions,
      })
  )
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

  await runSettingsAction(
    SETTINGS_ACCESS_PATH,
    "role_updated",
    (actorUserId) =>
      updateOrganizationRole({
        actorUserId,
        organizationId: parsed.data.organizationId,
        roleId: parsed.data.roleId,
        name: parsed.data.name,
        permissions: parsed.data.permissionsLocked
          ? undefined
          : parsed.data.permissions,
      })
  )
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

  await runSettingsAction(
    SETTINGS_ACCESS_PATH,
    "role_removed",
    (actorUserId) =>
      archiveOrganizationRole({
        actorUserId,
        organizationId: parsed.data.organizationId,
        roleId: parsed.data.roleId,
      }),
    isRoleInUse
  )
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

// Each settings service checks the actor's permission itself.
async function runSettingsAction(
  path: string,
  success: ActionFeedbackCode,
  operation: (actorUserId: string) => Promise<unknown>,
  failure?: (error: unknown) => ActionFeedbackCode | undefined
): Promise<never> {
  return runFormAction({
    event: `settings_${success}_action`,
    failure,
    path,
    success,
    run: async () => {
      const user = await getAuthenticatedUser()
      await operation(user.id)
      revalidatePath("/settings")

      // Roles also show on People.
      if (path === SETTINGS_ACCESS_PATH) {
        revalidatePath("/people")
      }
    },
  })
}

// Archiving a role that still has members or invites is a conflict worth naming.
function isRoleInUse(error: unknown): ActionFeedbackCode | undefined {
  return error instanceof OrganizationServiceError && error.statusCode === 409
    ? "role_in_use"
    : undefined
}
