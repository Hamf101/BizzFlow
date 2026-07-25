import { randomUUID } from "node:crypto"

import { captureUnexpectedError } from "@/lib/observability"
import { isOrganizationRole, type OrganizationRole } from "@/lib/permissions"
import { recordAuditLog } from "@/services/audit-service"
import type {
  InviteRow,
  LogValue,
  MembershipRow,
  OrganizationAuditLogInput,
  OrganizationRow,
  SupabaseErrorLike,
} from "@/services/organizations/contracts"
import { OrganizationServiceError } from "@/services/organizations/errors"
import type {
  InviteStatus,
  MembershipStatus,
  Organization,
  OrganizationInvite,
  OrganizationMembership,
} from "@/types/organization"

/**
 * Runs an organization operation with consistent observability and error translation.
 *
 * @param operationName - Stable operation identifier for logs.
 * @param identifiers - Non-secret context included with operation logs.
 * @param operation - Async organization operation to execute.
 * @returns The operation result.
 * @throws OrganizationServiceError when the operation is rejected or fails.
 */
export async function runOrganizationOperation<T>(
  operationName: string,
  identifiers: Record<string, LogValue>,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now()

  try {
    const result = await operation()
    console.info("organization_service_success", {
      operationName,
      durationMs: Date.now() - startedAt,
      ...identifiers,
    })
    return result
  } catch (error: unknown) {
    if (error instanceof OrganizationServiceError) {
      console.warn("organization_service_rejected", {
        operationName,
        durationMs: Date.now() - startedAt,
        statusCode: error.statusCode,
        reason: error.message,
        ...identifiers,
      })
      throw error
    }

    const setupError = createOrganizationSetupError(error)

    if (setupError) {
      console.warn("organization_service_rejected", {
        operationName,
        durationMs: Date.now() - startedAt,
        statusCode: setupError.statusCode,
        reason: setupError.message,
        ...identifiers,
      })
      throw setupError
    }

    console.error("organization_service_failed", {
      operationName,
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : "Unknown service error",
      ...identifiers,
    })
    captureUnexpectedError(error, { operationName, ...identifiers })
    throw new OrganizationServiceError("Organization service failed.", 500)
  }
}

/**
 * Records an organization audit event without failing the completed business mutation.
 *
 * @param input - Tenant-scoped audit event.
 * @param recorder - Optional injected audit writer used by tests.
 */
export async function recordOrganizationAuditLog(
  input: OrganizationAuditLogInput,
  recorder: (input: OrganizationAuditLogInput) => Promise<unknown> = recordAuditLog
): Promise<void> {
  try {
    await recorder(input)
  } catch (error: unknown) {
    console.warn("organization_audit_log_failed", {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      reason: error instanceof Error ? error.message : "Unknown audit error",
    })
  }
}

/**
 * Maps an organization database row to its public DTO.
 *
 * @param row - Organization database row.
 * @returns Organization DTO.
 */
export function mapOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Maps a membership database row to its public DTO.
 *
 * @param row - Membership database row.
 * @returns Membership DTO.
 */
export function mapMembership(row: MembershipRow): OrganizationMembership {
  return {
    id: row.id,
    organizationId: row.org_id,
    userId: row.user_id,
    role: parseOrganizationRole(row.role),
    status: parseMembershipStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Maps an invite database row to its public DTO.
 *
 * @param row - Invite database row.
 * @returns Invite DTO.
 */
export function mapInvite(row: InviteRow): OrganizationInvite {
  return {
    id: row.id,
    organizationId: row.org_id,
    email: row.email,
    role: parseOrganizationRole(row.role),
    token: row.token,
    status: parseInviteStatus(row.status),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }
}

/**
 * Translates a Supabase failure into a user-safe organization service error.
 *
 * @param error - Supabase or setup error.
 * @param fallbackMessage - Message used for ordinary database failures.
 * @param fallbackStatusCode - Status used for ordinary database failures.
 * @returns A user-safe organization service error.
 */
export function createSupabaseServiceError(
  error: unknown,
  fallbackMessage: string,
  fallbackStatusCode = 500
): OrganizationServiceError {
  const setupMessage = getSupabaseSetupFailureMessage(error)

  if (setupMessage) {
    return new OrganizationServiceError(setupMessage, 500)
  }

  return new OrganizationServiceError(fallbackMessage, fallbackStatusCode)
}

/**
 * Translates an invite-acceptance RPC failure into a user-safe error.
 *
 * @param error - Supabase RPC error.
 * @returns A user-safe organization service error.
 */
export function createAcceptInviteMutationError(
  error: unknown
): OrganizationServiceError {
  const errorLike = getSupabaseErrorLike(error)

  if (errorLike?.code === "P0002") {
    return new OrganizationServiceError("Invite is invalid or expired.", 404)
  }

  if (errorLike?.code === "22023") {
    return new OrganizationServiceError("Invite email is invalid.", 400)
  }

  return createSupabaseServiceError(error, "Unable to accept invite.")
}

/**
 * Translates a member-role RPC failure into a user-safe error.
 *
 * @param error - Supabase RPC error.
 * @returns A user-safe organization service error.
 */
export function createMemberRoleMutationError(
  error: unknown
): OrganizationServiceError {
  const errorLike = getSupabaseErrorLike(error)

  if (errorLike?.code === "23514") {
    return new OrganizationServiceError(
      "The organization must keep one owner.",
      400
    )
  }

  if (errorLike?.code === "42501") {
    return new OrganizationServiceError("You cannot update member roles.", 403)
  }

  if (errorLike?.code === "P0002") {
    return new OrganizationServiceError("Member was not found.", 404)
  }

  if (errorLike?.code === "22023") {
    return new OrganizationServiceError("That role cannot be assigned.", 400)
  }

  return createSupabaseServiceError(error, "Unable to update member role.")
}

/**
 * Validates and normalizes an organization display name.
 *
 * @param name - User-supplied organization name.
 * @returns Normalized organization name.
 * @throws OrganizationServiceError when the name length is invalid.
 */
export function normalizeOrganizationName(name: string): string {
  const normalizedName = name.trim().replace(/\s+/g, " ")

  if (normalizedName.length < 2 || normalizedName.length > 120) {
    throw new OrganizationServiceError(
      "Organization name must be between 2 and 120 characters.",
      400
    )
  }

  return normalizedName
}

/**
 * Validates and normalizes an email address.
 *
 * @param email - User-supplied email address.
 * @returns Lowercase normalized email address.
 * @throws OrganizationServiceError when the email is invalid.
 */
export function normalizeEmail(email: string): string {
  const normalizedEmail = email.trim().toLowerCase()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new OrganizationServiceError("Enter a valid email address.", 400)
  }

  return normalizedEmail
}

/**
 * Normalizes an optional email address.
 *
 * @param email - Optional email address.
 * @returns Normalized email, or null when absent.
 */
export function normalizeOptionalEmail(email: string | null): string | null {
  return email ? normalizeEmail(email) : null
}

/**
 * Creates a collision-resistant organization slug.
 *
 * @param name - Normalized organization name.
 * @returns URL-safe organization slug with a random suffix.
 */
export function createOrganizationSlug(name: string): string {
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return `${baseSlug || "organization"}-${randomUUID().slice(0, 8)}`
}

/**
 * Creates an opaque invite token.
 *
 * @returns Random invite token without separators.
 */
export function createInviteToken(): string {
  return randomUUID().replaceAll("-", "")
}

function parseOrganizationRole(value: string): OrganizationRole {
  if (!isOrganizationRole(value)) {
    throw new OrganizationServiceError(
      "Database returned an unsupported role.",
      500
    )
  }

  return value
}

function parseMembershipStatus(value: string): MembershipStatus {
  if (value === "active" || value === "disabled") {
    return value
  }

  throw new OrganizationServiceError(
    "Database returned an unsupported membership status.",
    500
  )
}

function parseInviteStatus(value: string): InviteStatus {
  if (
    value === "pending" ||
    value === "accepted" ||
    value === "revoked" ||
    value === "expired"
  ) {
    return value
  }

  throw new OrganizationServiceError(
    "Database returned an unsupported invite status.",
    500
  )
}

function createOrganizationSetupError(
  error: unknown
): OrganizationServiceError | null {
  if (
    error instanceof Error &&
    error.message.includes("Invalid admin Supabase environment")
  ) {
    return new OrganizationServiceError(
      "Supabase server credentials are not configured.",
      500
    )
  }

  return null
}

function getSupabaseSetupFailureMessage(error: unknown): string | null {
  const errorLike = getSupabaseErrorLike(error)
  const searchableMessage = [
    errorLike?.code,
    errorLike?.message,
    errorLike?.details,
    errorLike?.hint,
    error instanceof Error ? error.message : null,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  if (!searchableMessage) {
    return null
  }

  if (
    searchableMessage.includes("invalid api key") ||
    searchableMessage.includes("provided api key")
  ) {
    return "Supabase server credentials are invalid. Re-copy SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY from the Supabase dashboard."
  }

  if (
    errorLike?.code === "42P01" ||
    searchableMessage.includes("does not exist") ||
    searchableMessage.includes("could not find the table") ||
    searchableMessage.includes("schema cache")
  ) {
    return "Supabase database schema is not installed or exposed. Apply the Sprint 2 and Sprint 3 migrations."
  }

  if (
    searchableMessage.includes("permission denied for table") ||
    searchableMessage.includes("permission denied for schema")
  ) {
    return "Supabase table permissions are incomplete. Apply the latest migrations."
  }

  return null
}

function getSupabaseErrorLike(error: unknown): SupabaseErrorLike | null {
  if (!error || typeof error !== "object") {
    return null
  }

  return error as SupabaseErrorLike
}
