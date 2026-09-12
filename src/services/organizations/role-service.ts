import {
  ORGANIZATION_PERMISSION_ACTIONS,
  type OrganizationPermissionAction,
} from "@/lib/permissions"
import { createAdminClient } from "@/lib/supabase/admin"
import type {
  ArchiveOrganizationRoleInput,
  CreateOrganizationRoleInput,
  OrganizationMutationDeps,
  UpdateOrganizationRoleInput,
} from "@/services/organizations/contracts"
import { OrganizationServiceError } from "@/services/organizations/errors"
import {
  archiveOrganizationRoleRecord,
  createOrganizationRoleRecord,
  getActiveMembership,
  getOrganizationRoleRecord,
  updateOrganizationRoleRecord,
} from "@/services/organizations/repository"
import {
  recordOrganizationAuditLog,
  runOrganizationOperation,
} from "@/services/organizations/shared"
import type { OrganizationRoleDefinition } from "@/types/organization"

/**
 * Creates an editable custom access role.
 *
 * @param input - Owner, tenant, visible name, and granted actions.
 * @param deps - Optional database and audit dependencies for tests.
 * @returns Created role definition.
 * @throws OrganizationServiceError when validation or authorization fails.
 */
export async function createOrganizationRole(
  input: CreateOrganizationRoleInput,
  deps: OrganizationMutationDeps = {}
): Promise<OrganizationRoleDefinition> {
  return runOrganizationOperation(
    "create_organization_role",
    { actorUserId: input.actorUserId, organizationId: input.organizationId },
    async (): Promise<OrganizationRoleDefinition> => {
      const client = deps.client ?? createAdminClient()
      await requireOwner(client, input.organizationId, input.actorUserId)
      const name = normalizeRoleName(input.name)
      const permissions = normalizePermissions(input.permissions)
      const role = await createOrganizationRoleRecord(
        client,
        input.organizationId,
        name,
        permissions
      )

      await recordOrganizationAuditLog(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "organization_role.created",
          targetType: "organization_role",
          targetId: role.id,
          metadata: { name: role.name },
        },
        deps.recordAuditLog
      )

      return role
    }
  )
}

/**
 * Updates an organization role while keeping Owner permanently full-access.
 *
 * @param input - Owner, tenant, role, name, and optional permission changes.
 * @param deps - Optional database and audit dependencies for tests.
 * @returns Updated role definition.
 * @throws OrganizationServiceError when validation or authorization fails.
 */
export async function updateOrganizationRole(
  input: UpdateOrganizationRoleInput,
  deps: OrganizationMutationDeps = {}
): Promise<OrganizationRoleDefinition> {
  return runOrganizationOperation(
    "update_organization_role",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      roleId: input.roleId,
    },
    async (): Promise<OrganizationRoleDefinition> => {
      const client = deps.client ?? createAdminClient()
      await requireOwner(client, input.organizationId, input.actorUserId)
      const currentRole = await getOrganizationRoleRecord(
        client,
        input.organizationId,
        input.roleId
      )

      if (
        currentRole.systemKey === "owner_admin" &&
        input.permissions !== undefined
      ) {
        throw new OrganizationServiceError(
          "Owner access is permanent and cannot be changed.",
          400
        )
      }

      const values: {
        name: string
        permissions?: OrganizationPermissionAction[]
      } = { name: normalizeRoleName(input.name) }

      if (input.permissions !== undefined) {
        values.permissions = normalizePermissions(input.permissions)
      }

      const role = await updateOrganizationRoleRecord(
        client,
        input.organizationId,
        input.roleId,
        values
      )

      await recordOrganizationAuditLog(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "organization_role.updated",
          targetType: "organization_role",
          targetId: role.id,
          metadata: { name: role.name },
        },
        deps.recordAuditLog
      )

      return role
    }
  )
}

/**
 * Removes a non-owner role from active use while preserving its history.
 *
 * @param input - Owner, tenant, and role identifiers.
 * @param deps - Optional database and audit dependencies for tests.
 * @throws OrganizationServiceError when the role is protected or still in use.
 */
export async function archiveOrganizationRole(
  input: ArchiveOrganizationRoleInput,
  deps: OrganizationMutationDeps = {}
): Promise<void> {
  return runOrganizationOperation(
    "archive_organization_role",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      roleId: input.roleId,
    },
    async (): Promise<void> => {
      const client = deps.client ?? createAdminClient()
      await requireOwner(client, input.organizationId, input.actorUserId)
      await archiveOrganizationRoleRecord(
        client,
        input.organizationId,
        input.actorUserId,
        input.roleId
      )

      await recordOrganizationAuditLog(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "organization_role.archived",
          targetType: "organization_role",
          targetId: input.roleId,
          metadata: {},
        },
        deps.recordAuditLog
      )
    }
  )
}

async function requireOwner(
  client: NonNullable<OrganizationMutationDeps["client"]>,
  organizationId: string,
  actorUserId: string
): Promise<void> {
  const actor = await getActiveMembership(client, organizationId, actorUserId)

  if (actor?.role !== "owner_admin") {
    throw new OrganizationServiceError(
      "Only an organization owner can manage access roles.",
      403
    )
  }
}

function normalizeRoleName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, " ")

  if (normalized.length < 2 || normalized.length > 60) {
    throw new OrganizationServiceError(
      "Role name must be between 2 and 60 characters.",
      400
    )
  }

  return normalized
}

function normalizePermissions(
  permissions: readonly OrganizationPermissionAction[]
): OrganizationPermissionAction[] {
  const normalized = [...new Set(permissions)]

  if (
    normalized.some(
      (permission) => !ORGANIZATION_PERMISSION_ACTIONS.includes(permission)
    )
  ) {
    throw new OrganizationServiceError(
      "One or more access permissions are not supported.",
      400
    )
  }

  return normalized
}
