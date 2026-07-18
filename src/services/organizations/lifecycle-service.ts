import { createAdminClient } from "@/lib/supabase/admin"
import type { CreateOrganizationInput } from "@/services/organizations/contracts"
import {
  createOrganizationRecord,
  createOwnerMembership,
  deleteOrganizationRecord,
  ensureProfile,
  getFirstActiveMembership,
  getOrganizationById,
} from "@/services/organizations/repository"
import {
  createOrganizationSlug,
  normalizeOrganizationName,
  recordOrganizationAuditLog,
  runOrganizationOperation,
} from "@/services/organizations/shared"
import type { OrganizationContext } from "@/types/organization"

/**
 * Creates an organization and owner membership for an authenticated user.
 *
 * @param input - Authenticated user and organization form values.
 * @returns Created organization context.
 * @throws OrganizationServiceError when validation or Supabase writes fail.
 */
export async function createOrganization(
  input: CreateOrganizationInput
): Promise<OrganizationContext> {
  return runOrganizationOperation(
    "create_organization",
    { userId: input.userId },
    async (): Promise<OrganizationContext> => {
      const client = createAdminClient()
      const name = normalizeOrganizationName(input.name)

      await ensureProfile(client, input.userId, input.userEmail)

      const organization = await createOrganizationRecord(
        client,
        name,
        createOrganizationSlug(name),
        input.userId
      )

      try {
        const membership = await createOwnerMembership(
          client,
          organization.id,
          input.userId
        )

        await recordOrganizationAuditLog({
          organizationId: organization.id,
          actorUserId: input.userId,
          action: "organization.created",
          targetType: "organization",
          targetId: organization.id,
          metadata: { role: "owner_admin" },
        })

        return { organization, membership }
      } catch (error: unknown) {
        await deleteOrganizationRecord(client, organization.id)
        throw error
      }
    }
  )
}

/**
 * Loads the first active organization context for an authenticated user.
 *
 * @param userId - Authenticated Supabase user id.
 * @returns Current organization context, or null when the user has none.
 * @throws OrganizationServiceError when Supabase reads fail.
 */
export async function getCurrentOrganizationContext(
  userId: string
): Promise<OrganizationContext | null> {
  return runOrganizationOperation(
    "get_current_organization_context",
    { userId },
    async (): Promise<OrganizationContext | null> => {
      const client = createAdminClient()
      const membership = await getFirstActiveMembership(client, userId)

      if (!membership) {
        return null
      }

      return {
        organization: await getOrganizationById(
          client,
          membership.organizationId
        ),
        membership,
      }
    }
  )
}
