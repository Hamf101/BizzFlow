import { createAdminClient } from "@/lib/supabase/admin"
import { runOrganizationOperation } from "@/services/organizations/shared"
import type { OrganizationMutationDeps } from "@/services/organizations/contracts"

/** Which onboarding milestones an organization has actually reached. */
export type OnboardingProgress = {
  hasInvitedMembers: boolean
  hasPublishedTemplate: boolean
  hasSubmission: boolean
}

/**
 * Reads which onboarding milestones a workspace has genuinely reached.
 *
 * The dashboard checklist previously hardcoded every step but the first as
 * incomplete, so it could never progress past 1 of 4 no matter what the
 * workspace did. Each flag here is derived from real tenant data.
 *
 * A missing relation is treated as "not reached" rather than an error: the
 * checklist is guidance, and a workspace on an older schema should still see
 * a usable dashboard.
 *
 * @param organizationId - Tenant whose progress is being summarised.
 * @param deps - Optional database dependency for tests.
 * @returns One boolean per milestone after the organization itself.
 */
export async function getOnboardingProgress(
  organizationId: string,
  deps: OrganizationMutationDeps = {}
): Promise<OnboardingProgress> {
  return runOrganizationOperation(
    "get_onboarding_progress",
    { organizationId },
    async (): Promise<OnboardingProgress> => {
      const client = deps.client ?? createAdminClient()

      const [members, invites, templates, submissions] = await Promise.all([
        client
          .from("organization_memberships")
          .select("id")
          .eq("org_id", organizationId)
          .eq("status", "active")
          .limit(2),
        client
          .from("invites")
          .select("id")
          .eq("org_id", organizationId)
          .eq("status", "pending")
          .limit(1),
        client
          .from("document_templates")
          .select("id")
          .eq("org_id", organizationId)
          .eq("status", "published")
          .limit(1),
        client
          .from("submissions")
          .select("id")
          .eq("org_id", organizationId)
          .limit(1),
      ])

      const rows = (result: { data: unknown }): number =>
        Array.isArray(result.data) ? result.data.length : 0

      return {
        // The owner is a member too, so a second membership or any pending
        // invite is what proves somebody was actually invited.
        hasInvitedMembers: rows(members) > 1 || rows(invites) > 0,
        hasPublishedTemplate: rows(templates) > 0,
        hasSubmission: rows(submissions) > 0,
      }
    }
  )
}
