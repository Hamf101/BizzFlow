import type { ListSort } from "@/lib/list-state"
import { createAdminClient } from "@/lib/supabase/admin"
import { captureUnexpectedError } from "@/lib/observability"
import { createListInputValidators } from "@/services/list-input"
import {
  POSTGREST_BATCH_SIZE,
  readAllInBatches,
  readCountedPage,
} from "@/services/postgrest-paging"
import {
  AUDIT_LOG_ACTIONS,
  AUDIT_LOG_SORT_KEYS,
  AUDIT_LOG_TARGET_TYPES,
  type AuditLogAction,
  type AuditLogEntry,
  type AuditLogSortKey,
  type AuditLogTargetType,
  type AuditMetadata,
} from "@/types/audit"
import { requireOrgPermission } from "@/services/organizations/active-membership"
import { ServiceError } from "@/services/service-error"

type AdminClient = ReturnType<typeof createAdminClient>

const AUDIT_LOG_COLUMNS =
  "id,org_id,actor_user_id,action,target_type,target_id,metadata,seq,created_at"

type AuditLogRow = {
  id: string
  org_id: string
  actor_user_id: string | null
  action: string
  target_type: string
  target_id: string | null
  metadata: Record<string, unknown>
  seq: number
  created_at: string
}

export type RecordAuditLogInput = {
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

const MAX_AUDIT_PAGE_SIZE = 200

/**
 * Error type raised by audit log service operations.
 */
export class AuditServiceError extends ServiceError {
  override readonly name = "AuditServiceError"
}

// The audit log has no search, so its checks leave the search limit out.
const AUDIT_LIST_INPUT = createListInputValidators({
  label: "Audit log",
  maxPageSize: MAX_AUDIT_PAGE_SIZE,
  reject: (message: string): Error => new AuditServiceError(message, 400),
  sortKeys: AUDIT_LOG_SORT_KEYS,
})

/**
 * Records an audit event through the trusted admin client.
 *
 * @param input - Organization, actor, target, and metadata for the event.
 * @param deps - Optional trusted database client.
 * @returns Created audit log entry.
 * @throws AuditServiceError when the audit event cannot be written.
 */
export async function recordAuditLog(
  input: RecordAuditLogInput,
  deps: AuditServiceDeps = {}
): Promise<AuditLogEntry> {
  const startedAt = Date.now()

  try {
    const client = deps.client ?? createAdminClient()
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
 * Records an audit event that must not undo the change it records, which is
 * already made. A lost event is logged and reported to monitoring by its ids
 * alone: its metadata can name people.
 *
 * @param input - Organization, actor, target, and metadata for the event.
 * @param record - The writer; tests pass their own.
 */
export async function recordAuditLogBestEffort<TInput extends RecordAuditLogInput>(
  input: TInput,
  record: (input: TInput) => Promise<unknown> = recordAuditLog
): Promise<void> {
  try {
    await record(input)
  } catch (error: unknown) {
    const ids = {
      action: input.action,
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetId: input.targetId ?? null,
    }

    console.warn("audit_log_lost", { ...ids, reason: error instanceof Error ? error.message : "Unknown audit error" })
    captureUnexpectedError(error, { operation: "audit_log", ...ids })
  }
}

/**
 * Lists one page of an organization's audit events, in sequence order, with the
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

  const page = AUDIT_LIST_INPUT.page(input.page)
  const pageSize = AUDIT_LIST_INPUT.pageSize(input.pageSize)
  const ascending = AUDIT_LIST_INPUT.sort(input.sort).direction === "asc"
  const targetTypes = normalizeAuditTargetTypes(input.targetTypes)
  const from = (page - 1) * pageSize
  const { rows, total } = await readCountedPage(
    await filterAuditLogs(
      client.from("audit_logs").select(AUDIT_LOG_COLUMNS, { count: "exact" }),
      input.organizationId,
      targetTypes
    )
      // seq is the total order the log is read in.
      .order("seq", { ascending })
      .range(from, from + pageSize - 1),
    () => countAuditLogs(client, input.organizationId, targetTypes),
    (): Error => new AuditServiceError("Unable to load audit logs.", 500)
  )

  return {
    entries: (rows as AuditLogRow[]).map(mapAuditLog),
    page,
    pageSize,
    total,
  }
}

/**
 * Reads every audit event that matches a view, for a complete export.
 *
 * Batches follow the log's sequence rather than offsets, so an event
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

  const ascending = AUDIT_LIST_INPUT.sort(input.sort).direction === "asc"
  const targetTypes = normalizeAuditTargetTypes(input.targetTypes)
  const maxEntries = deps.maxExportEntries ?? AUDIT_EXPORT_MAX_ENTRIES
  const rows = await readAllInBatches(
    async (previous: AuditLogRow | undefined) => {
      let query = filterAuditLogs(
        client.from("audit_logs").select(AUDIT_LOG_COLUMNS),
        input.organizationId,
        targetTypes
      )

      if (previous !== undefined) {
        query = ascending
          ? query.gt("seq", previous.seq)
          : query.lt("seq", previous.seq)
      }

      const { data, error } = await query
        .order("seq", { ascending })
        .limit(POSTGREST_BATCH_SIZE)

      return { data: data as AuditLogRow[] | null, error }
    },
    {
      fail: (): Error => new AuditServiceError("Unable to export audit logs.", 500),
      maxRows: maxEntries,
      tooMany: (): Error =>
        new AuditServiceError(
          `This export has more than ${maxEntries.toLocaleString("en")} events. Choose a kind of record to export it in parts.`,
          413
        ),
    }
  )

  return rows.map(mapAuditLog)
}

async function requireAuditView(
  client: AuditServiceClient,
  organizationId: string,
  actorUserId: string
): Promise<void> {
  await requireOrgPermission(client, organizationId, actorUserId, "audit_logs:view", {
    loadFailed: () => new AuditServiceError("Unable to load audit permissions.", 500),
    denied: () => new AuditServiceError("You cannot view audit logs.", 403),
    unknownRole: () => new AuditServiceError("Database returned an unsupported role.", 500),
  })
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

function mapAuditLog(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    organizationId: row.org_id,
    actorUserId: row.actor_user_id,
    action: readKnownOrRaw(row.action, AUDIT_LOG_ACTIONS, "action"),
    targetType: readKnownOrRaw(row.target_type, AUDIT_LOG_TARGET_TYPES, "target"),
    targetId: row.target_id,
    metadata: parseAuditMetadata(row.metadata),
    seq: row.seq,
    createdAt: row.created_at,
  }
}

/**
 * Reads a stored action or target. A value newer than this build is kept as
 * written, so one unfamiliar entry cannot take down the log or its export.
 */
function readKnownOrRaw(value: string, known: readonly string[], kind: string): string {
  if (!known.includes(value)) {
    console.warn("audit_log_unknown_value", { kind, value })
  }

  return value
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
