import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  directWriteActions,
  getAuthenticatedWriteGrantStatements,
  getMigrationPath,
  getTableDefinition,
  normalizeSql,
} from "./migration-contract-helpers"

const sprint5MigrationPath = getMigrationPath(
  "20260717190016_sprint_5_document_versioning_comments.sql"
)
const sprint5AtomicCommentsMigrationPath = getMigrationPath(
  "20260717193648_sprint_5_atomic_document_comments.sql"
)
const sprint5HardeningMigrationPath = getMigrationPath(
  "20260717194631_sprint_5_completion_archive_hardening.sql"
)
const sprint5CollaborationTables = [
  "document_comments",
  "document_activity_events",
] as const

describe("Sprint 5 document versioning and comments migration", () => {
  it("creates immutable collaboration rows with tenant-scoped relationships", () => {
    const sql = readFileSync(sprint5MigrationPath, "utf8")
    const commentsSql = getTableDefinition(sql, "document_comments")
    const activitySql = getTableDefinition(sql, "document_activity_events")

    expect(commentsSql).toContain("id uuid primary key default gen_random_uuid()")
    expect(commentsSql).toContain(
      "org_id uuid not null references public.organizations (id) on delete cascade"
    )
    expect(commentsSql).toContain(
      "created_by uuid references public.profiles (id) on delete set null"
    )
    expect(commentsSql).toContain("created_at timestamptz not null default now()")
    expect(commentsSql).not.toContain("updated_at")
    expect(commentsSql).toContain(
      "foreign key (document_id, org_id) references public.documents (id, org_id) on delete cascade"
    )
    expect(commentsSql).toContain(
      "check (body = btrim(body) and char_length(btrim(body)) between 1 and 2000)"
    )

    expect(activitySql).toContain("id uuid primary key default gen_random_uuid()")
    expect(activitySql).toContain(
      "org_id uuid not null references public.organizations (id) on delete cascade"
    )
    expect(activitySql).toContain(
      "actor_user_id uuid references public.profiles (id) on delete set null"
    )
    expect(activitySql).toContain("metadata jsonb not null default '{}'::jsonb")
    expect(activitySql).toContain("created_at timestamptz not null default now()")
    expect(activitySql).not.toContain("updated_at")
    expect(activitySql).toContain(
      "foreign key (document_id, org_id) references public.documents (id, org_id) on delete cascade"
    )
    expect(activitySql).toContain("'document.uploaded'")
    expect(activitySql).toContain("'document.replaced'")
    expect(activitySql).toContain("'document.commented'")
    expect(activitySql).toContain("'document.archived'")
    expect(activitySql).toContain("check (jsonb_typeof(metadata) = 'object')")
  })

  it("indexes tenant timelines and every nullable profile foreign key", () => {
    const sql = readFileSync(sprint5MigrationPath, "utf8")

    expect(sql).toContain("create index document_comments_document_created_idx")
    expect(sql).toContain("on public.document_comments (document_id, created_at desc)")
    expect(sql).toContain("create index document_comments_org_created_idx")
    expect(sql).toContain("on public.document_comments (org_id, created_at desc)")
    expect(sql).toContain("create index document_comments_created_by_idx")
    expect(sql).toContain("on public.document_comments (created_by)")
    expect(sql).toContain("create index document_activity_events_document_created_idx")
    expect(sql).toContain(
      "on public.document_activity_events (document_id, created_at desc)"
    )
    expect(sql).toContain("create index document_activity_events_org_created_idx")
    expect(sql).toContain("on public.document_activity_events (org_id, created_at desc)")
    expect(sql).toContain("create index document_activity_events_actor_user_idx")
    expect(sql).toContain("on public.document_activity_events (actor_user_id)")
  })

  it("enforces forced RLS with member-only authenticated reads", () => {
    const sql = readFileSync(sprint5MigrationPath, "utf8")

    expect(sql).toContain("alter table public.document_comments enable row level security")
    expect(sql).toContain(
      "alter table public.document_activity_events enable row level security"
    )
    expect(sql).toContain("alter table public.document_comments force row level security")
    expect(sql).toContain(
      "alter table public.document_activity_events force row level security"
    )
    expect(sql).toContain("create policy document_comments_select_member")
    expect(sql).toContain("create policy document_activity_events_select_member")
    expect(sql.match(/using \(\(select public\.is_organization_member\(org_id\)\)\)/g)).toHaveLength(
      2
    )
  })

  it("grants authenticated reads and minimal service-role inserts only", () => {
    const migrationSql = readFileSync(sprint5MigrationPath, "utf8")
    const sql = normalizeSql(migrationSql)

    expect(migrationSql).toContain("grant usage on schema public to authenticated, service_role")
    expect(migrationSql).toContain("revoke all on table public.document_comments from anon")
    expect(migrationSql).toContain(
      "revoke all on table public.document_activity_events from anon"
    )
    expect(migrationSql).toContain(
      "revoke insert, update, delete on table public.document_comments from authenticated"
    )
    expect(migrationSql).toContain(
      "revoke insert, update, delete on table public.document_activity_events from authenticated"
    )
    expect(migrationSql).toContain("grant select on table public.document_comments to authenticated")
    expect(migrationSql).toContain(
      "grant select on table public.document_activity_events to authenticated"
    )
    expect(migrationSql).toContain(
      "grant select, insert on table public.document_comments to service_role"
    )
    expect(migrationSql).toContain(
      "grant select, insert on table public.document_activity_events to service_role"
    )
    expect(migrationSql).toContain(
      "revoke update, delete on table public.document_comments from service_role"
    )
    expect(migrationSql).toContain(
      "revoke update, delete on table public.document_activity_events from service_role"
    )
    expect(
      getAuthenticatedWriteGrantStatements(migrationSql, sprint5CollaborationTables)
    ).toEqual([])

    sprint5CollaborationTables.forEach(
      (tableName: (typeof sprint5CollaborationTables)[number]): void => {
        directWriteActions.forEach((action: (typeof directWriteActions)[number]): void => {
          expect(sql).not.toMatch(
            new RegExp(`create policy [^;]+ on public\\.${tableName} [^;]+ for ${action}( |;)`)
          )
        })
      }
    )
  })

  it("allocates pending versions atomically while holding the document lock", () => {
    const sql = normalizeSql(readFileSync(sprint5MigrationPath, "utf8"))
    const signature =
      "create or replace function public.create_pending_document_version( target_org_id uuid, target_document_id uuid, target_version_id uuid, target_storage_key text, target_original_filename text, target_content_type text, target_byte_size bigint, target_checksum_sha256 text, target_uploaded_by uuid ) returns uuid language plpgsql security invoker set search_path = ''"

    expect(sql).toContain(signature)
    expect(sql).toContain(
      "from public.documents document where document.id = target_document_id and document.org_id = target_org_id for update"
    )
    expect(sql).toContain("if not found then raise exception 'document not found.'")
    expect(sql).toContain("if document_archived_at is not null then raise exception")
    expect(sql).toContain("select coalesce(max(version.version_number), 0) + 1")
    expect(sql).toContain(
      "from public.document_versions version where version.document_id = target_document_id and version.org_id = target_org_id"
    )
    expect(sql).toContain("insert into public.document_versions")
    expect(sql).toContain("next_version_number, 'upload_pending'")
    expect(sql).toContain("returning id into created_version_id")
    expect(sql).toContain("return created_version_id")
  })

  it("completes pending versions and promotes only a newer current version", () => {
    const sql = normalizeSql(readFileSync(sprint5MigrationPath, "utf8"))
    const signature =
      "create or replace function public.complete_document_version( target_org_id uuid, target_document_id uuid, target_version_id uuid, target_actor_user_id uuid ) returns boolean language plpgsql security invoker set search_path = ''"
    const documentLock =
      "from public.documents document where document.id = target_document_id and document.org_id = target_org_id for update"
    const versionLock =
      "from public.document_versions version where version.id = target_version_id and version.document_id = target_document_id and version.org_id = target_org_id for update"

    expect(sql).toContain(signature)
    expect(sql).toContain(documentLock)
    expect(sql).toContain(versionLock)
    expect(sql.indexOf(documentLock)).toBeLessThan(sql.indexOf(versionLock))
    expect(sql).toContain("if document_archived_at is not null then raise exception")
    expect(sql).toContain("if completed_version_status <> 'upload_pending' then raise exception")
    expect(sql).toContain("update public.document_versions set status = 'available'")
    expect(sql).toContain(
      "when completed_version_number > coalesce(current_version_number, 0) then target_version_id else document.current_version_id end, updated_by = target_actor_user_id"
    )
    const completeFunctionSql = sql.slice(sql.indexOf(signature))

    expect(completeFunctionSql).toContain(
      "insert into public.document_activity_events"
    )
    expect(completeFunctionSql).toContain(
      "when completed_version_number = 1 then 'document.uploaded' else 'document.replaced' end"
    )
    expect(completeFunctionSql).toContain(
      "'versionnumber', completed_version_number"
    )
    expect(sql).toContain("return true")
  })

  it("backfills member-visible activity for existing available versions and archives", () => {
    const sql = normalizeSql(readFileSync(sprint5MigrationPath, "utf8"))

    expect(sql).toContain(
      "from public.document_versions version where version.status = 'available'"
    )
    expect(sql).toContain(
      "from public.documents document where document.archived_at is not null"
    )
  })

  it("makes both RPC functions callable only by the service role", () => {
    const sql = normalizeSql(readFileSync(sprint5MigrationPath, "utf8"))
    const createArguments = "uuid, uuid, uuid, text, text, text, bigint, text, uuid"
    const completeArguments = "uuid, uuid, uuid, uuid"

    expect(sql).toContain(
      `revoke execute on function public.create_pending_document_version( ${createArguments} ) from public, anon, authenticated`
    )
    expect(sql).toContain(
      `revoke execute on function public.complete_document_version( ${completeArguments} ) from public, anon, authenticated`
    )
    expect(sql).toContain(
      `grant execute on function public.create_pending_document_version( ${createArguments} ) to service_role`
    )
    expect(sql).toContain(
      `grant execute on function public.complete_document_version( ${completeArguments} ) to service_role`
    )
  })

  it("reloads the PostgREST schema cache after table, policy, and RPC changes", () => {
    const sql = readFileSync(sprint5MigrationPath, "utf8")

    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})

describe("Sprint 5 atomic document comments migration", () => {
  it("creates comments and timeline activity in one document-locked RPC", () => {
    const sql = normalizeSql(
      readFileSync(sprint5AtomicCommentsMigrationPath, "utf8")
    )
    const signature =
      "create or replace function public.create_document_comment( target_org_id uuid, target_document_id uuid, target_comment_id uuid, target_body text, target_actor_user_id uuid ) returns uuid language plpgsql security invoker set search_path = ''"
    const documentLock =
      "from public.documents document where document.id = target_document_id and document.org_id = target_org_id for update"
    const commentInsert = "insert into public.document_comments"
    const activityInsert = "insert into public.document_activity_events"

    expect(sql).toContain(signature)
    expect(sql).toContain(documentLock)
    expect(sql).toContain("if not found then raise exception 'document not found.'")
    expect(sql).toContain(
      "if document_archived_at is not null then raise exception 'archived documents cannot be commented on.'"
    )
    expect(sql).toContain(commentInsert)
    expect(sql).toContain("returning id into created_comment_id")
    expect(sql).toContain(activityInsert)
    expect(sql).toContain("'document.commented'")
    expect(sql).toContain(
      "jsonb_build_object('commentid', created_comment_id)"
    )
    expect(sql.indexOf(documentLock)).toBeLessThan(sql.indexOf(commentInsert))
    expect(sql.indexOf(commentInsert)).toBeLessThan(sql.indexOf(activityInsert))
    expect(sql).toContain("return created_comment_id")
  })

  it("allows only the service role to execute the atomic comment RPC", () => {
    const sql = normalizeSql(
      readFileSync(sprint5AtomicCommentsMigrationPath, "utf8")
    )
    const argumentsList = "uuid, uuid, uuid, text, uuid"

    expect(sql).toContain(
      `revoke execute on function public.create_document_comment( ${argumentsList} ) from public, anon, authenticated`
    )
    expect(sql).toContain(
      `grant execute on function public.create_document_comment( ${argumentsList} ) to service_role`
    )
    expect(sql).not.toContain("security definer")
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})

describe("Sprint 5 completion and archive hardening migration", () => {
  it("makes locked completion idempotent without duplicating activity", () => {
    const sql = normalizeSql(
      readFileSync(sprint5HardeningMigrationPath, "utf8")
    )
    const documentLock =
      "from public.documents document where document.id = target_document_id and document.org_id = target_org_id for update"
    const versionLock =
      "from public.document_versions version where version.id = target_version_id and version.document_id = target_document_id and version.org_id = target_org_id for update"
    const availableReturn =
      "if completed_version_status = 'available' then return true; end if"
    const activityInsert = "insert into public.document_activity_events"

    expect(sql).toContain(documentLock)
    expect(sql).toContain(versionLock)
    expect(sql).toContain(availableReturn)
    expect(sql.indexOf(versionLock)).toBeLessThan(sql.indexOf(availableReturn))
    expect(sql.indexOf(availableReturn)).toBeLessThan(sql.indexOf(activityInsert))
  })

  it("archives and records activity in one document-locked transaction", () => {
    const sql = normalizeSql(
      readFileSync(sprint5HardeningMigrationPath, "utf8")
    )
    const signature =
      "create or replace function public.archive_document( target_org_id uuid, target_document_id uuid, target_actor_user_id uuid ) returns boolean language plpgsql security invoker set search_path = ''"
    const documentLock =
      "from public.documents document where document.id = target_document_id and document.org_id = target_org_id for update"
    const archiveUpdate = "update public.documents document set archived_at = now()"
    const archiveFunction = sql.slice(sql.indexOf(signature))

    expect(sql).toContain(signature)
    expect(archiveFunction).toContain(documentLock)
    expect(archiveFunction).toContain(
      "if document_archived_at is not null then return false; end if"
    )
    expect(archiveFunction).toContain(archiveUpdate)
    expect(archiveFunction).toContain("insert into public.document_activity_events")
    expect(archiveFunction).toContain("'document.archived'")
    expect(archiveFunction.indexOf(documentLock)).toBeLessThan(
      archiveFunction.indexOf(archiveUpdate)
    )
  })

  it("allows only the service role to execute hardened mutations", () => {
    const sql = normalizeSql(
      readFileSync(sprint5HardeningMigrationPath, "utf8")
    )

    expect(sql).toContain(
      "revoke execute on function public.complete_document_version( uuid, uuid, uuid, uuid ) from public, anon, authenticated"
    )
    expect(sql).toContain(
      "grant execute on function public.complete_document_version( uuid, uuid, uuid, uuid ) to service_role"
    )
    expect(sql).toContain(
      "revoke execute on function public.archive_document( uuid, uuid, uuid ) from public, anon, authenticated"
    )
    expect(sql).toContain(
      "grant execute on function public.archive_document( uuid, uuid, uuid ) to service_role"
    )
    expect(sql).not.toContain("security definer")
    expect(sql).toContain(
      "reserved for future end-to-end checksum enforcement; current uploads leave this null."
    )
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})
