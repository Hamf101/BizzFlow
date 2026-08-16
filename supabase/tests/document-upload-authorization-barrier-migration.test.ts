import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getAuthenticatedWriteGrantStatements,
  getMigrationPath,
  normalizeSql,
} from "./migration-contract-helpers"

const migrationSql = readFileSync(
  getMigrationPath("20260803160319_document_upload_authorization_barrier.sql"),
  "utf8"
)
const sql = normalizeSql(migrationSql)
const purgeLifecycleSql = normalizeSql(
  readFileSync(
    getMigrationPath("20260729115742_document_folder_purge_lifecycle.sql"),
    "utf8"
  )
)

describe("document upload authorization barrier migration", () => {
  it("adds a nullable exact-expiry column with a conservative browser-upload backfill", () => {
    expect(sql).toContain(
      "add column upload_authorization_expires_at timestamptz"
    )
    expect(sql).toContain("migration_time timestamptz := clock_timestamp()")
    expect(sql).toContain(
      "set upload_authorization_expires_at = migration_time + interval '7 days'"
    )
    expect(sql).toContain(
      "where version.upload_authorization_expires_at is null"
    )
    expect(sql).toContain(
      "from public.generated_document_finalizations finalization"
    )
    expect(sql).toContain(
      "finalization.document_version_id = version.id"
    )
    expect(sql).not.toContain(
      "alter column upload_authorization_expires_at set not null"
    )
    expect(sql).not.toContain(
      "alter column upload_authorization_expires_at set default"
    )
  })

  it("atomically raises barriers, revokes active leases, and reopens deleted objects", () => {
    expect(sql).toContain(
      "lock table public.resource_purge_jobs in share row exclusive mode"
    )
    expect(sql).toContain(
      "lock table public.resource_purge_objects in share row exclusive mode"
    )
    expect(sql).toContain(
      "set available_at = greatest(object_row.available_at, barrier.available_at)"
    )
    expect(sql).toContain(
      "when object_row.status in ('processing', 'deleted') then 'retry_wait'"
    )
    expect(sql).toContain(
      "when object_row.status = 'processing' then null"
    )
    expect(sql).toContain(
      "when object_row.status = 'deleted' then null"
    )
    expect(sql).toContain("then 'upload_barrier_raised'")
    expect(sql).toContain(
      "add constraint resource_purge_objects_upload_barrier_check"
    )
    expect(sql).toContain("or deleted_at >= available_at")

    const populateSql = getFunctionDefinition(
      sql,
      "private.populate_resource_purge_objects"
    )

    expect(populateSql).toContain(
      "version.upload_authorization_expires_at"
    )
    expect(populateSql).toContain("populated_at as available_at")
    expect(populateSql).toContain("union all")
    expect(populateSql).toContain("max(manifest.available_at)")
    expect(populateSql).toContain("group by manifest.storage_key")
    expect(populateSql).toContain(
      "on conflict (job_id, storage_key) do update"
    )
    expect(populateSql).toContain(
      "greatest( existing_object.available_at, excluded.available_at )"
    )
    expect(purgeLifecycleSql).toContain("object_row.available_at <= now()")
  })

  it("preserves a raised barrier through lease recovery, failures, completion, and finalization", () => {
    const leaseSql = getFunctionDefinition(
      sql,
      "public.lease_resource_purge_objects"
    )
    const completionSql = getFunctionDefinition(
      sql,
      "public.complete_resource_purge_object"
    )
    const failureSql = getFunctionDefinition(
      sql,
      "public.fail_resource_purge_object"
    )
    const deleteGuardSql = getFunctionDefinition(
      sql,
      "private.enforce_resource_purge_object_delete_barrier"
    )

    expect(leaseSql).toContain(
      "else greatest(object_row.available_at, now())"
    )
    expect(leaseSql).toContain("object_row.available_at <= now()")
    expect(completionSql).toContain(
      "if object_row.available_at > clock_timestamp()"
    )
    expect(completionSql).toContain(
      "purge object upload barrier is still active"
    )
    expect(failureSql).toContain(
      "next_available_at := greatest(object_row.available_at, retry_at)"
    )
    expect(failureSql).toContain(
      "available_at = greatest(job.available_at, next_available_at)"
    )
    expect(deleteGuardSql).toContain(
      "if old.available_at > clock_timestamp()"
    )
    expect(sql).toContain(
      "create trigger enforce_resource_purge_object_delete_barrier before delete on public.resource_purge_objects"
    )
  })

  it("provides a bounded post-drain reconciliation step for controlled deployments", () => {
    const reconciliationSql = getFunctionDefinition(
      sql,
      "public.reconcile_document_upload_authorization_barriers"
    )

    expect(reconciliationSql).toContain(
      "target_conservative_until > clock_timestamp() + interval '7 days'"
    )
    expect(reconciliationSql).toContain(
      "lock table public.document_versions in share row exclusive mode"
    )
    expect(reconciliationSql).toContain(
      "when object_row.status in ('processing', 'deleted') then 'retry_wait'"
    )
    expect(reconciliationSql).toContain(
      "greatest( version.upload_authorization_expires_at, target_conservative_until )"
    )
    expect(reconciliationSql).toContain(
      "finalization.document_version_id = version.id"
    )
  })

  it("serializes authorization with lifecycle changes before extending the owned pending version", () => {
    const authorizationSql = getFunctionDefinition(
      sql,
      "public.register_document_version_upload_authorization"
    )
    const documentLockIndex = authorizationSql.indexOf(
      "select document.lifecycle_state"
    )
    const activeCheckIndex = authorizationSql.indexOf(
      "if document_lifecycle_state <> 'active'"
    )
    const versionLockIndex = authorizationSql.indexOf(
      "select version.status, version.uploaded_by"
    )
    const updateIndex = authorizationSql.indexOf(
      "update public.document_versions version"
    )

    expect(authorizationSql).toContain("security invoker")
    expect(authorizationSql).toContain("for update")
    expect(authorizationSql).toContain("version_status <> 'upload_pending'")
    expect(authorizationSql).toContain(
      "version_uploaded_by is distinct from target_uploaded_by"
    )
    expect(authorizationSql).toContain(
      "greatest( version.upload_authorization_expires_at, target_expires_at )"
    )
    expect(documentLockIndex).toBeGreaterThan(-1)
    expect(activeCheckIndex).toBeGreaterThan(documentLockIndex)
    expect(versionLockIndex).toBeGreaterThan(activeCheckIndex)
    expect(updateIndex).toBeGreaterThan(versionLockIndex)
  })

  it("keeps authorization, reconciliation, allocation, and purge workers service-role-only", () => {
    const authorizationSignature =
      "public.register_document_version_upload_authorization( uuid, uuid, uuid, uuid, timestamptz )"
    const allocationSignature =
      "public.create_pending_document_version( uuid, uuid, uuid, text, text, text, bigint, text, uuid, timestamptz )"
    const reconciliationSignature =
      "public.reconcile_document_upload_authorization_barriers( timestamptz )"
    const purgeSignatures = [
      "public.lease_resource_purge_objects( integer, integer )",
      "public.complete_resource_purge_object( uuid, uuid )",
      "public.fail_resource_purge_object( uuid, uuid, text )",
    ]

    for (const signature of [
      authorizationSignature,
      allocationSignature,
      reconciliationSignature,
      ...purgeSignatures,
    ]) {
      expect(sql).toContain(
        `revoke execute on function ${signature} from public, anon, authenticated, service_role`
      )
      expect(sql).toContain(`grant execute on function ${signature} to service_role`)
    }

    expect(
      getAuthenticatedWriteGrantStatements(migrationSql, [
        "document_versions",
        "resource_purge_objects",
      ])
    ).toEqual([])
    expect(sql).not.toContain("create policy")
    expect(sql).not.toContain("create index")
  })

  it("hardens legacy replacement allocation without adding an overloaded signature", () => {
    const allocationSql = getFunctionDefinition(
      sql,
      "public.create_pending_document_version"
    )

    expect(allocationSql).toContain("select document.lifecycle_state")
    expect(allocationSql).toContain("for update")
    expect(allocationSql).toContain("document_lifecycle_state <> 'active'")
    expect(allocationSql).toContain("upload_authorization_expires_at")
    expect(allocationSql).toContain("clock_timestamp() + interval '7 days'")
    expect(allocationSql).toContain(
      "target_upload_authorization_expires_at timestamptz default null"
    )
    expect(sql).toContain(
      "drop function public.create_pending_document_version( uuid, uuid, uuid, text, text, text, bigint, text, uuid )"
    )
    expect(
      sql.match(
        /create (?:or replace )?function public\.create_pending_document_version\(/g
      )
    ).toHaveLength(1)
  })

  it("leaves server-generated finalization versions without an artificial upload delay", () => {
    const populateSql = getFunctionDefinition(
      sql,
      "private.populate_resource_purge_objects"
    )

    expect(sql).not.toContain(
      "alter column upload_authorization_expires_at set default"
    )
    expect(populateSql).toContain(
      "coalesce( version.upload_authorization_expires_at, populated_at )"
    )
    expect(populateSql).toContain("populated_at as available_at")
  })

  it("reloads the PostgREST schema cache", () => {
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})

/**
 * Extracts one normalized PL/pgSQL function definition from migration SQL.
 *
 * @param normalizedSql - Whitespace-normalized migration source.
 * @param functionName - Schema-qualified function name.
 * @returns The normalized function definition through its dollar-quote terminator.
 * @throws Error when the requested function is absent.
 */
function getFunctionDefinition(
  normalizedSql: string,
  functionName: string
): string {
  const replaceableStart = normalizedSql.indexOf(
    `create or replace function ${functionName}`
  )
  const plainStart = normalizedSql.indexOf(`create function ${functionName}`)
  const start = replaceableStart >= 0 ? replaceableStart : plainStart

  if (start < 0) {
    throw new Error(`Missing function ${functionName}.`)
  }

  const end = normalizedSql.indexOf("$$;", start)

  if (end < 0) {
    throw new Error(`Missing terminator for function ${functionName}.`)
  }

  return normalizedSql.slice(start, end + 3)
}
