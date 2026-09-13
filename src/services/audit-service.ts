import { MAX_LIST_PAGE, type ListSort } from "@/lib/list-state"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  canPerformOrganizationAction,
  createOrganizationPermissionSubject,
  isOrganizationRole,
  type OrganizationPermissionSubject,
} from "@/lib/permissions"
import {
  AUDIT_LOG_ACTIONS,
  AUDIT_LOG_SORT_KEYS,
  AUDIT_LOG_TARGET_TYPES,
  type AuditChainVerification,
  type AuditLogAction,
  type AuditLogEntry,
  type AuditLogSortKey,
  type AuditLogTargetType,
  type AuditMetadata,
} from "@/types/audit"

type AdminClient = ReturnType<typeof createAdminClient>

const AUDIT_LOG_COLUMNS =
  "id,org_id,actor_user_id,action,target_type,target_id,metadata,seq,prev_hash,entry_hash,created_at"

type AuditLogRow = {
  id: string
  org_id: string
  actor_user_id: string | null
  action: string
  target_type: string
  target_id: string | null
  metadata: Record<string, unknown>
  seq: number
  prev_hash: string | null
  entry_hash: string
  created_at: string
}

type MembershipRow = {
  role: string
  role_definition?: { permissions: string[] | null } | null
}

type RecordAuditLogInput = {
  organizationId: string
  actorUserId: string | null
  action: AuditLogAction
  targetType: AuditLogTargetType
  targetId?: string | null
  metadata?: AuditMetadata
}

type AuditServiceClient = Pick<AdminClient, "from">

/** Dependencies an audit read may replace, so tests can inject fakes. */
export type AuditServiceDeps = {
  client?: AuditServiceClient
  /** Largest export allowed before the request is refused. */
  maxExportEntries?: number
}

/** Input for one page of an organization's audit events. */
export type ListAuditLogPageInput = {
  actorUserId: string
  organizationId: string
  /** One-based page number. */
  page: number
  pageSize: number
  sort: ListSort<AuditLogSortKey>
  /** Kinds of record to include; every kind when absent. */
  targetTypes?: readonly AuditLogTargetType[]
}

/** One page of audit events and how many events match its filters. */
export type AuditLogPage = {
  entries: AuditLogEntry[]
  page: number
  pageSize: number
  total: number
}

/** Input for exporting every audit event that matches a view. */
export type ExportAuditLogsInput = Omit<ListAuditLogPageInput, "page" | "pageSize">

/** Largest audit export, in events; a bigger one must be narrowed first. */
export const AUDIT_EXPORT_MAX_ENTRIES = 50_000

// PostgREST answers with at most 1,000 rows (`max_rows` in supabase/config.toml).
const AUDIT_EXPORT_BATCH_SIZE = 1_000
const MAX_AUDIT_PAGE_SIZE = 200
/** PostgREST's code for a counted range that starts past the last row. */
const RANGE_NOT_SATISFIABLE = "PGRST103"

/**
 * Error type raised by audit log service operations.
 */
export class AuditServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates an audit service error with an HTTP-style status code.
   *
   * @param message - User-safe error message.
   * @param statusCode - HTTP-style status code for route/action translation.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "AuditServiceError"
    this.statusCode = statusCode
  }
}

/**
 * Records an audit event through the trusted admin client.
 *
 * @param input - Organization, actor, target, and metadata for the event.
 * @returns Created audit log entry.
 * @throws AuditServiceError when the audit event cannot be written.
 */
export async function recordAuditLog(
  input: RecordAuditLogInput
): Promise<AuditLogEntry> {
  const startedAt = Date.now()

  try {
    const client = createAdminClient()
    const { data, error } = await client
      .from("audit_logs")
      .insert({
        org_id: input.organizationId,
        actor_user_id: input.actorUserId,
        action: input.action,
        target_type: input.targetType,
        target_id: input.targetId ?? null,
        metadata: input.metadata ?? {},
      })
      .select(AUDIT_LOG_COLUMNS)
      .single()

    if (error || !data) {
      throw new AuditServiceError("Unable to record audit event.", 500)
    }

    console.info("audit_log_recorded", {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      durationMs: Date.now() - startedAt,
    })

    return mapAuditLog(data as AuditLogRow)
  } catch (error: unknown) {
    if (error instanceof AuditServiceError) {
      console.warn("audit_log_rejected", {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: input.action,
        reason: error.message,
        statusCode: error.statusCode,
        durationMs: Date.now() - startedAt,
      })
      throw error
    }

    console.error("audit_log_failed", {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      reason: error instanceof Error ? error.message : "Unknown audit error",
      durationMs: Date.now() - startedAt,
    })
    throw new AuditServiceError("Audit service failed.", 500)
  }
}

/**
 * Lists one page of an organization's audit events, in chain order, with the
 * number of events that match the filters.
 *
 * @param input - Actor, organization, page, order, and kinds of record.
 * @param deps - Optional trusted database client.
 * @returns The page's events and the matching total.
 * @throws AuditServiceError when access, validation, or the read fails.
 */
export async function listAuditLogPage(
  input: ListAuditLogPageInput,
  deps: AuditServiceDeps = {}
): Promise<AuditLogPage> {
  const client = deps.client ?? createAdminClient()
  await requireAuditView(client, input.organizationId, input.actorUserId)

  const page = normalizeAuditPage(input.page)
  const pageSize = normalizeAuditPageSize(input.pageSize)
  const ascending = normalizeAuditSort(input.sort).direction === "asc"
  const targetTypes = normalizeAuditTargetTypes(input.targetTypes)
  const from = (page - 1) * pageSize
  const { count, data, error } = await filterAuditLogs(
    client.from("audit_logs").select(AUDIT_LOG_COLUMNS, { count: "exact" }),
    input.organizationId,
    targetTypes
  )
    // seq is the chain's total order per organization.
    .order("seq", { ascending })
    .range(from, from + pageSize - 1)

  // PostgREST refuses a counted range that starts past the last event (416)
  // instead of answering with an empty page; count on its own instead, so a
  // stale link can still be sent to the last page.
  if (error?.code === RANGE_NOT_SATISFIABLE) {
    return {
      entries: [],
      page,
      pageSize,
      total: await countAuditLogs(client, input.organizationId, targetTypes),
    }
  }

  if (error || !data) {
    throw new AuditServiceError("Unable to load audit logs.", 500)
  }

  return {
    entries: (data as AuditLogRow[]).map(mapAuditLog),
    page,
    pageSize,
    total: count ?? 0,
  }
}

/**
 * Reads every audit event that matches a view, for a complete export.
 *
 * Batches follow the chain's sequence rather than offsets, so an event
 * recorded during the export can neither shift a batch boundary nor appear
 * twice. An export larger than the limit is refused, never truncated.
 *
 * @param input - Actor, organization, order, and kinds of record.
 * @param deps - Optional trusted database client and export limit.
 * @returns Every matching event, in the requested order.
 * @throws AuditServiceError when access, validation, the limit, or a read fails.
 */
export async function exportAuditLogs(
  input: ExportAuditLogsInput,
  deps: AuditServiceDeps = {}
): Promise<AuditLogEntry[]> {
  const client = deps.client ?? createAdminClient()
  await requireAuditView(client, input.organizationId, input.actorUserId)

  const ascending = normalizeAuditSort(input.sort).direction === "asc"
  const targetTypes = normalizeAuditTargetTypes(input.targetTypes)
  const maxEntries = deps.maxExportEntries ?? AUDIT_EXPORT_MAX_ENTRIES
  const entries: AuditLogEntry[] = []

  for (;;) {
    const lastSeq = entries.at(-1)?.seq
    let query = filterAuditLogs(
      client.from("audit_logs").select(AUDIT_LOG_COLUMNS),
      input.organizationId,
      targetTypes
    )

    if (lastSeq !== undefined) {
      query = ascending ? query.gt("seq", lastSeq) : query.lt("seq", lastSeq)
    }

    const { data, error } = await query
      .order("seq", { ascending })
      .limit(AUDIT_EXPORT_BATCH_SIZE)

    if (error || !data) {
      throw new AuditServiceError("Unable to export audit logs.", 500)
    }

    const batch = (data as AuditLogRow[]).map(mapAuditLog)

    // Only an empty batch proves the end. A deployment may cap responses
    // below the requested batch (`max_rows`), so a short batch alone does not
    // mean nothing follows, and stopping there would truncate the export.
    if (batch.length === 0) {
      return entries
    }

    if (entries.length + batch.length > maxEntries) {
      throw new AuditServiceError(
        `This export has more than ${maxEntries.toLocaleString("en")} events. Choose a kind of record to export it in parts.`,
        413
      )
    }

    entries.push(...batch)
  }
}

async function requireAuditView(
  client: AuditServiceClient,
  organizationId: string,
  actorUserId: string
): Promise<void> {
  const actor = await getOrganizationRole(client, organizationId, actorUserId)

  if (!actor || !canPerformOrganizationAction(actor, "audit_logs:view")) {
    throw new AuditServiceError("You cannot view audit logs.", 403)
  }
}

// Filters go through a minimal view of the query builder: relating
// PostgREST's generated builder type to an interface makes the compiler give
// up (TS2589). Every filter returns the same builder at runtime, so the
// caller's own type comes back unchanged.
type AuditFilterQuery = {
  eq(column: string, value: string): AuditFilterQuery
  in(column: string, values: readonly string[]): AuditFilterQuery
}

function filterAuditLogs<TQuery>(
  query: TQuery,
  organizationId: string,
  targetTypes: readonly AuditLogTargetType[] | null
): TQuery {
  let filtered = (query as unknown as AuditFilterQuery).eq(
    "org_id",
    organizationId
  )

  if (targetTypes !== null) {
    filtered = filtered.in("target_type", targetTypes)
  }

  return filtered as unknown as TQuery
}

async function countAuditLogs(
  client: AuditServiceClient,
  organizationId: string,
  targetTypes: readonly AuditLogTargetType[] | null
): Promise<number> {
  const { count, error } = await filterAuditLogs(
    client.from("audit_logs").select("id", { count: "exact", head: true }),
    organizationId,
    targetTypes
  )

  if (error) {
    throw new AuditServiceError("Unable to load audit logs.", 500)
  }

  return count ?? 0
}

function normalizeAuditPage(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIST_PAGE) {
    throw new AuditServiceError(
      `Audit log page must be a whole number from 1 to ${MAX_LIST_PAGE}.`,
      400
    )
  }

  return value
}

function normalizeAuditPageSize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_AUDIT_PAGE_SIZE) {
    throw new AuditServiceError(
      `Audit log page size must be between 1 and ${MAX_AUDIT_PAGE_SIZE}.`,
      400
    )
  }

  return value
}

function normalizeAuditSort(
  value: ListSort<string>
): ListSort<AuditLogSortKey> {
  const key = AUDIT_LOG_SORT_KEYS.find(
    (candidate: AuditLogSortKey): boolean => candidate === value.key
  )

  if (!key || (value.direction !== "asc" && value.direction !== "desc")) {
    throw new AuditServiceError("Audit log order is not supported.", 400)
  }

  return { direction: value.direction, key }
}

function normalizeAuditTargetTypes(
  value: readonly string[] | undefined
): AuditLogTargetType[] | null {
  if (value === undefined || value.length === 0) {
    return null
  }

  const targetTypes = Array.from(new Set(value))

  if (
    !targetTypes.every((type: string): type is AuditLogTargetType =>
      (AUDIT_LOG_TARGET_TYPES as readonly string[]).includes(type)
    )
  ) {
    throw new AuditServiceError("Audit log filter is not supported.", 400)
  }

  return targetTypes
}

type VerifyAuditLogChainInput = {
  actorUserId: string
  organizationId: string
}

/**
 * Verifies the organization's audit hash chain server-side.
 *
 * Recomputation happens inside the database function, so no cross-language
 * jsonb canonicalization is ever relied on. Reads bypass RLS via the admin
 * client, so permission is enforced here like every other audit read.
 *
 * @param input - Actor and organization identifiers.
 * @returns Chain verification verdict with the first invalid sequence, if any.
 * @throws AuditServiceError when the actor lacks permission or the check fails.
 */
export async function verifyAuditLogChain(
  input: VerifyAuditLogChainInput
): Promise<AuditChainVerification> {
  const client = createAdminClient()
  const actorRole = await getOrganizationRole(
    client,
    input.organizationId,
    input.actorUserId
  )

  if (
    !actorRole ||
    !canPerformOrganizationAction(actorRole, "audit_logs:verify")
  ) {
    throw new AuditServiceError("You cannot verify audit logs.", 403)
  }

  const { data, error } = await client.rpc("verify_audit_log_chain", {
    target_org_id: input.organizationId,
  })

  const verdict = data?.[0]

  if (error || !verdict) {
    throw new AuditServiceError("Unable to verify the audit log chain.", 500)
  }

  return {
    valid: verdict.valid,
    checkedCount: verdict.checked_count,
    firstInvalidSeq: verdict.first_invalid_seq,
    failureReason: verdict.failure_reason,
  }
}

async function getOrganizationRole(
  client: AuditServiceClient,
  organizationId: string,
  userId: string
): Promise<OrganizationPermissionSubject | null> {
  const { data, error } = await client
    .from("organization_memberships")
    .select(
      "role,role_definition:organization_roles!organization_memberships_role_definition_fk(permissions)"
    )
    .eq("org_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle()

  if (error) {
    throw new AuditServiceError("Unable to load audit permissions.", 500)
  }

  if (!data) {
    return null
  }

  const row = data as MembershipRow

  if (!isOrganizationRole(row.role)) {
    throw new AuditServiceError("Database returned an unsupported role.", 500)
  }

  const subject = createOrganizationPermissionSubject(
    row.role,
    row.role_definition?.permissions
  )

  if (!subject) {
    throw new AuditServiceError(
      "Database returned unsupported role permissions.",
      500
    )
  }

  return subject
}

function mapAuditLog(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    organizationId: row.org_id,
    actorUserId: row.actor_user_id,
    action: parseAuditLogAction(row.action),
    targetType: parseAuditLogTargetType(row.target_type),
    targetId: row.target_id,
    metadata: parseAuditMetadata(row.metadata),
    seq: row.seq,
    prevHash: row.prev_hash,
    entryHash: row.entry_hash,
    createdAt: row.created_at,
  }
}

function parseAuditLogAction(value: string): AuditLogAction {
  if (AUDIT_LOG_ACTIONS.includes(value as AuditLogAction)) {
    return value as AuditLogAction
  }

  throw new AuditServiceError("Database returned an unsupported audit action.", 500)
}

function parseAuditLogTargetType(value: string): AuditLogTargetType {
  if (AUDIT_LOG_TARGET_TYPES.includes(value as AuditLogTargetType)) {
    return value as AuditLogTargetType
  }

  throw new AuditServiceError("Database returned an unsupported audit target.", 500)
}

function parseAuditMetadata(value: Record<string, unknown>): AuditMetadata {
  const metadata: AuditMetadata = {}

  Object.entries(value).forEach(([key, entryValue]: [string, unknown]) => {
    if (
      typeof entryValue === "string" ||
      typeof entryValue === "number" ||
      typeof entryValue === "boolean" ||
      entryValue === null
    ) {
      metadata[key] = entryValue
    }
  })

  return metadata
}
