import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  directWriteActions,
  getAuthenticatedWriteGrantStatements,
  getTableDefinition,
  normalizeSql,
} from "./migration-contract-helpers"

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260718190946_sprint_8_submission_review_workflow.sql"
)
const migrationSource = readFileSync(migrationPath, "utf8")
const sql = normalizeSql(migrationSource)
const hardeningMigrationSource = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260718194429_sprint_8_submission_function_lint.sql"
  ),
  "utf8"
)
const hardeningSql = normalizeSql(hardeningMigrationSource)
const reviewTables = [
  "submission_comments",
  "submission_activity_events",
] as const
const serviceOnlyFunctions = [
  "assign_internal_submission",
  "transition_internal_submission",
  "create_internal_submission_comment",
] as const

/**
 * Extract one normalized function definition without including later functions.
 *
 * @param functionName - Unqualified public function name.
 * @returns Normalized SQL for the requested function definition.
 * @throws Error when the requested function definition is absent.
 */
function getFunctionSection(
  functionName: string,
  normalizedSource: string = sql
): string {
  const signature = `create or replace function public.${functionName}(`
  const start = normalizedSource.indexOf(signature)

  if (start < 0) {
    throw new Error(`Missing function definition for public.${functionName}.`)
  }

  const nextFunction = normalizedSource.indexOf(
    "create or replace function public.",
    start + signature.length
  )
  return normalizedSource.slice(start, nextFunction < 0 ? undefined : nextFunction)
}

/**
 * Extract one normalized semicolon-terminated SQL statement by its prefix.
 *
 * @param prefix - Normalized beginning of the requested statement.
 * @returns The complete normalized statement.
 * @throws Error when the statement is absent or unterminated.
 */
function getStatement(prefix: string): string {
  const start = sql.indexOf(prefix)
  const end = sql.indexOf(";", start)

  if (start < 0 || end < 0) {
    throw new Error(`Missing SQL statement beginning with: ${prefix}`)
  }

  return sql.slice(start, end)
}

describe("Sprint 8 submission review workflow migration", () => {
  it("expands submissions to the seven-state legal workflow", () => {
    expect(sql).toContain(
      "status in ( 'draft', 'submitted', 'in_review', 'needs_changes', 'approved', 'rejected', 'completed' )"
    )
    expect(sql).toContain("old.status = 'draft' and new.status = 'submitted'")
    expect(sql).toContain("old.status = 'submitted' and new.status = 'in_review'")
    expect(sql).toContain(
      "old.status = 'in_review' and new.status in ('needs_changes', 'approved', 'rejected')"
    )
    expect(sql).toContain("old.status = 'needs_changes' and new.status = 'submitted'")
    expect(sql).toContain("old.status = 'approved' and new.status = 'completed'")
    expect(sql).toContain("raise exception 'submission status transition is invalid.'")
    expect(sql).toContain("old.status in ('draft', 'needs_changes')")
  })

  it("adds tenant-bound assignment metadata and query-shaped indexes", () => {
    expect(migrationSource).toContain("add column assigned_to uuid")
    expect(migrationSource).toContain("add column assigned_by uuid")
    expect(migrationSource).toContain("add column assigned_at timestamptz")
    expect(sql).toContain(
      "foreign key (assigned_to) references public.profiles (id) on delete set null"
    )
    expect(sql).toContain(
      "foreign key (assigned_by) references public.profiles (id) on delete set null"
    )
    expect(sql).toContain(
      "create index submissions_org_assignee_status_idx on public.submissions (org_id, assigned_to, status, updated_at desc, id) where assigned_at is not null"
    )
    expect(sql).toContain(
      "status = 'draft' and submitted_by is null and submitted_at is null and assigned_to is null and assigned_by is null and assigned_at is null"
    )
    expect(sql).toContain(
      "status in ( 'in_review', 'needs_changes', 'approved', 'rejected', 'completed' ) and submitted_at is not null and assigned_at is not null"
    )
  })

  it("creates immutable comments and activity with tenant-scoped relationships", () => {
    const commentsSql = normalizeSql(
      getTableDefinition(migrationSource, "submission_comments")
    )
    const activitySql = normalizeSql(
      getTableDefinition(migrationSource, "submission_activity_events")
    )

    expect(commentsSql).toContain("body = btrim(body)")
    expect(commentsSql).toContain("char_length(body) between 1 and 2000")
    expect(commentsSql).toContain(
      "foreign key (submission_id, org_id) references public.submissions (id, org_id) on delete cascade"
    )
    expect(commentsSql).not.toContain("updated_at")

    expect(activitySql).toContain(
      "foreign key (submission_id, org_id) references public.submissions (id, org_id) on delete cascade"
    )
    expect(activitySql).toContain(
      "foreign key (comment_id, org_id, submission_id) references public.submission_comments (id, org_id, submission_id)"
    )
    expect(activitySql).toContain(
      "event_type in ( 'submitted', 'resubmitted', 'assigned', 'commented', 'changes_requested', 'approved', 'rejected', 'completed' )"
    )
    expect(activitySql).toContain("submission_revision integer not null")
    expect(activitySql).not.toContain("updated_at")
    expect(sql).toContain(
      "create index submission_comments_submission_created_idx on public.submission_comments (submission_id, created_at, id)"
    )
    expect(sql).toContain(
      "create index submission_activity_submission_created_idx on public.submission_activity_events (submission_id, created_at, id)"
    )
  })

  it("constrains every activity event to its legal transition and evidence shape", () => {
    const activitySql = normalizeSql(
      getTableDefinition(migrationSource, "submission_activity_events")
    )

    expect(activitySql).toContain(
      "event_type = 'submitted' and from_status = 'draft' and to_status = 'submitted' and comment_id is null"
    )
    expect(activitySql).toContain(
      "event_type = 'resubmitted' and from_status = 'needs_changes' and to_status = 'submitted' and comment_id is null"
    )
    expect(activitySql).toContain(
      "(from_status = 'submitted' and to_status = 'in_review') or (from_status = 'in_review' and to_status = 'in_review') or (from_status = 'needs_changes' and to_status = 'needs_changes')"
    )
    expect(activitySql).toContain(
      "event_type = 'changes_requested' and from_status = 'in_review' and to_status = 'needs_changes' and comment_id is not null"
    )
    expect(activitySql).toContain(
      "event_type = 'rejected' and from_status = 'in_review' and to_status = 'rejected' and comment_id is not null"
    )
    expect(activitySql).toContain(
      "event_type = 'completed' and from_status = 'approved' and to_status = 'completed'"
    )
  })

  it("uses parent-scoped RLS for manager, creator, and assigned external-reviewer reads", () => {
    for (const tableName of reviewTables) {
      expect(sql).toContain(`alter table public.${tableName} enable row level security`)
      expect(sql).toContain(`alter table public.${tableName} force row level security`)
      expect(sql).toContain(`grant select on table public.${tableName} to authenticated`)
    }

    expect(sql).toContain(
      "(select public.organization_role_for(org_id)) in ('owner_admin', 'manager')"
    )
    expect(sql).toContain(
      "(select public.organization_role_for(org_id)) = 'staff' and created_by = (select auth.uid())"
    )
    expect(sql).toContain(
      "(select public.organization_role_for(org_id)) = 'external_reviewer' and assigned_to = (select auth.uid()) and status <> 'draft'"
    )
    expect(sql).toContain(
      "status = 'available' and (select public.organization_role_for(org_id)) = 'external_reviewer'"
    )
    expect(sql).toContain(
      "submission.id = submission_comments.submission_id and submission.org_id = submission_comments.org_id"
    )
    expect(sql).toContain(
      "submission.id = submission_activity_events.submission_id and submission.org_id = submission_activity_events.org_id"
    )

    for (const policyPrefix of [
      "create policy submission_files_select_internal_member",
      "create policy submission_comments_select_visible_submission",
      "create policy submission_activity_select_visible_submission",
    ]) {
      const policySql = getStatement(policyPrefix)

      expect(policySql).toContain("in ('owner_admin', 'manager')")
      expect(policySql).toContain("= 'staff'")
      expect(policySql).toContain("= 'external_reviewer'")
      expect(policySql).toContain("submission.assigned_to = (select auth.uid())")
      expect(policySql).toContain("submission.status <> 'draft'")
    }

    expect(
      getStatement("create policy submission_files_select_internal_member")
    ).toContain("status = 'available'")
  })

  it("keeps review tables immutable to authenticated clients", () => {
    expect(getAuthenticatedWriteGrantStatements(migrationSource, reviewTables)).toEqual([])

    for (const tableName of reviewTables) {
      expect(sql).toContain(
        `revoke all on table public.${tableName} from anon, authenticated, service_role`
      )
      expect(sql).toContain(
        `grant select, insert on table public.${tableName} to service_role`
      )
      directWriteActions.forEach((action: (typeof directWriteActions)[number]): void => {
        expect(sql).not.toMatch(
          new RegExp(`create policy [^;]+ on public\\.${tableName} [^;]+ for ${action}( |;)`)
        )
      })
    }
  })

  it("assigns under a tenant lock with eligibility, revision, activity, and audit checks", () => {
    const assignSql = getFunctionSection("assign_internal_submission")

    expect(assignSql).toContain(
      "perform public.assert_internal_submission_review_manager( target_org_id, target_actor_user_id )"
    )
    expect(assignSql).toContain(
      "assignee_role not in ('owner_admin', 'manager', 'external_reviewer')"
    )
    expect(assignSql).toContain(
      "where submission.id = target_submission_id and submission.org_id = target_org_id for update"
    )
    expect(assignSql).toContain("locked_submission.revision <> target_expected_revision")
    expect(assignSql).toContain(
      "locked_submission.status not in ('submitted', 'in_review', 'needs_changes')"
    )
    expect(assignSql).toContain("when previous_status = 'submitted' then 'in_review'")
    expect(assignSql).toContain("insert into public.submission_activity_events")
    expect(assignSql).toContain("'assigned'")
    expect(assignSql).toContain("insert into public.audit_logs")
    expect(assignSql).toContain("'submission.assigned'")
  })

  it("transitions only the assigned manager and writes comments, activity, and audits atomically", () => {
    const transitionSql = getFunctionSection("transition_internal_submission")

    expect(transitionSql).toContain(
      "target_transition not in ( 'needs_changes', 'approved', 'rejected', 'completed' )"
    )
    expect(transitionSql).toContain(
      "target_transition in ('needs_changes', 'rejected') and normalized_comment is null"
    )
    expect(transitionSql).toContain(
      "locked_submission.assigned_to is null or locked_submission.assigned_to <> target_actor_user_id"
    )
    expect(transitionSql).toContain(
      "locked_submission.status = 'in_review' and target_transition in ('needs_changes', 'approved', 'rejected')"
    )
    expect(transitionSql).toContain(
      "locked_submission.status = 'approved' and target_transition = 'completed'"
    )
    expect(transitionSql).toContain("insert into public.submission_comments")
    expect(transitionSql).toContain("insert into public.submission_activity_events")
    expect(transitionSql).toContain("insert into public.audit_logs")
    expect(transitionSql).toContain("'submission.changes_requested'")
  })

  it("creates visible non-draft comments with matching activity and audit evidence", () => {
    const commentSql = getFunctionSection("create_internal_submission_comment")

    expect(commentSql).toContain("normalized_body := btrim(target_body)")
    expect(commentSql).toContain("char_length(normalized_body) > 2000")
    expect(commentSql).toContain("locked_submission.status = 'draft'")
    expect(commentSql).toContain(
      "actor_role = 'staff' and locked_submission.created_by = target_actor_user_id"
    )
    expect(commentSql).toContain(
      "actor_role = 'external_reviewer' and locked_submission.assigned_to = target_actor_user_id"
    )
    expect(commentSql).toContain("insert into public.submission_comments")
    expect(commentSql).toContain("'commented'")
    expect(commentSql).toContain("'submission.commented'")
  })

  it("records first submission and resubmission evidence while retaining assignment", () => {
    const submitSql = getFunctionSection("submit_internal_submission")

    expect(submitSql).toContain("locked_submission.status not in ('draft', 'needs_changes')")
    expect(submitSql).toContain(
      "when previous_status = 'draft' then 'submitted' else 'resubmitted'"
    )
    expect(submitSql).toContain(
      "when previous_status = 'draft' then 'submission.submitted' else 'submission.resubmitted'"
    )
    expect(submitSql).toContain("locked_submission.assigned_to")
    expect(submitSql).toContain("insert into public.submission_activity_events")
    expect(submitSql).toContain("insert into public.audit_logs")
    expect(sql).toContain(
      "insert into public.submission_activity_events ( id, org_id, submission_id, actor_user_id, event_type, from_status, to_status, submission_revision, created_at ) select gen_random_uuid(), submission.org_id, submission.id, submission.submitted_by, 'submitted', 'draft', 'submitted', submission.revision, submission.submitted_at from public.submissions submission where submission.status = 'submitted'"
    )
  })

  it("allows the creator to replace files while changes are requested", () => {
    const lockSql = getFunctionSection("lock_editable_internal_submission")
    const allocateSql = getFunctionSection("allocate_internal_submission_file")
    const completeSql = getFunctionSection("complete_internal_submission_file")
    const supersedeSql = getFunctionSection("supersede_internal_submission_file")
    const renewSql = getFunctionSection(
      "record_internal_submission_file_upload_window"
    )

    expect(lockSql).toContain(
      "locked_submission.status not in ('draft', 'needs_changes')"
    )
    expect(allocateSql).toContain(
      "locked_submission := public.lock_editable_internal_submission( target_org_id, target_submission_id, target_actor_user_id )"
    )
    expect(completeSql).toContain(
      "locked_submission := public.lock_editable_internal_submission( target_org_id, target_submission_id, target_actor_user_id )"
    )
    expect(supersedeSql).toContain(
      "locked_submission.status not in ('draft', 'needs_changes')"
    )
    expect(renewSql).toContain(
      "locked_submission := public.lock_editable_internal_submission( target_org_id, target_submission_id, target_actor_user_id )"
    )
  })

  it("keeps all review mutations service-role-only and security-invoker", () => {
    for (const functionName of serviceOnlyFunctions) {
      const functionSql = getFunctionSection(functionName)

      expect(functionSql).toContain("language plpgsql security invoker set search_path = ''")
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.${functionName}\\([^;]+\\) from public, anon, authenticated, service_role`
        )
      )
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function public\\.${functionName}\\([^;]+\\) to service_role`
        )
      )
    }

    expect(sql).not.toContain("security definer")
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })

  it("matches transition retries to the exact normalized review comment", () => {
    expect(hardeningSql).toContain(
      "left join public.submission_comments review_comment on review_comment.id = activity.comment_id"
    )
    expect(hardeningSql).toContain(
      "review_comment.body is not distinct from normalized_comment"
    )
    expect(hardeningSql).toContain(
      "activity.submission_revision = locked_submission.revision"
    )
    expect(hardeningSql).toContain(
      "raise exception 'submission review has changed. reload and try again.' using errcode = '40001'"
    )
  })

  it("keeps editable file locks without unused composite variables", () => {
    for (const functionName of [
      "complete_internal_submission_file",
      "record_internal_submission_file_upload_window",
    ]) {
      const functionSql = getFunctionSection(functionName, hardeningSql)

      expect(functionSql).toContain(
        "perform public.lock_editable_internal_submission( target_org_id, target_submission_id, target_actor_user_id )"
      )
      expect(functionSql).not.toContain(
        "locked_submission public.submissions%rowtype"
      )
    }
  })
})
