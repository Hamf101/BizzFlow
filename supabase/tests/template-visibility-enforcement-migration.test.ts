import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { getMigrationPath, normalizeSql } from "./migration-contract-helpers"

const visibilityMigrationPath = getMigrationPath(
  "20260729122927_template_visibility_enforcement.sql"
)
const visibilitySql = normalizeSql(
  readFileSync(visibilityMigrationPath, "utf8")
)
const laterPublicFormSql = normalizeSql(
  readFileSync(
    getMigrationPath("20260730120000_sprint_11_public_form_links.sql"),
    "utf8"
  )
)

/**
 * Isolates one normalized function declaration and body.
 *
 * @param sql - Normalized migration SQL.
 * @param qualifiedName - Schema-qualified function name.
 * @returns Function SQL through its terminating dollar quote.
 * @throws Error when the declaration is absent.
 */
function getFunctionSection(sql: string, qualifiedName: string): string {
  const start = sql.indexOf(`create or replace function ${qualifiedName}(`)

  if (start === -1) {
    throw new Error(`Missing function ${qualifiedName}.`)
  }

  const end = sql.indexOf(" $$;", start)

  if (end === -1) {
    throw new Error(`Missing function terminator for ${qualifiedName}.`)
  }

  return sql.slice(start, end + 4)
}

describe("template visibility enforcement migration", () => {
  it("implements fail-closed v2/v3 visibility with canonical defaults", () => {
    const helper = getFunctionSection(
      visibilitySql,
      "private.template_block_is_visible"
    )

    expect(helper).toContain("if snapshot_version = '2' then return true")
    expect(helper).toContain("snapshot_version is distinct from '3'")
    expect(helper).toContain("source_block_index >= current_block_index")
    expect(helper).toContain("current_block_id = any(visited_block_ids)")
    expect(helper).toContain(
      "condition - array['sourceblockid', 'operator', 'value']::text[] <> '{}'::jsonb"
    )
    expect(helper).toContain("source_block -> 'checkedbydefault'")
    expect(helper).toContain("else 'false'::jsonb")
    expect(helper).toContain("else '\"\"'::jsonb")
    expect(helper).toContain(
      "effective_source_value is distinct from expected_source_value"
    )
  })

  it("prunes to unique, visible, non-file scalar snapshot fields", () => {
    const pruneHelper = getFunctionSection(
      visibilitySql,
      "private.prune_template_scalar_values"
    )

    expect(pruneHelper).toContain("if matching_block_count <> 1")
    expect(pruneHelper).toContain("'signature_field'")
    expect(pruneHelper).not.toContain("'file_field'")
    expect(pruneHelper).toContain("private.template_block_is_visible")
    expect(pruneHelper).toContain(
      "pruned_values := pruned_values || jsonb_build_object"
    )
  })

  it("keeps helpers invoker-only and inaccessible to browser roles", () => {
    expect(visibilitySql).not.toContain("security definer")
    expect(visibilitySql).toMatch(
      /create or replace function private\.template_block_is_visible\([^;]+security invoker set search_path = ''/
    )
    expect(visibilitySql).toMatch(
      /create or replace function private\.prune_template_scalar_values\([^;]+security invoker set search_path = ''/
    )
    expect(visibilitySql).toContain(
      "revoke all on function private.template_block_is_visible(jsonb, text, jsonb) from public, anon, authenticated"
    )
    expect(visibilitySql).toContain(
      "grant execute on function private.template_block_is_visible(jsonb, text, jsonb) to service_role"
    )
    expect(visibilitySql).not.toMatch(
      /grant execute on function private\.[^(]+\([^;]+ to (anon|authenticated)/
    )
  })

  it("pre-prunes generated answers before merge and post-prunes the result", () => {
    const trigger = getFunctionSection(
      visibilitySql,
      "private.enforce_document_answer_visibility"
    )
    const mergeRpc = getFunctionSection(
      visibilitySql,
      "public.merge_generated_document_answers"
    )

    const triggerPrePrune = trigger.indexOf(
      "pre_patch_values := private.prune_template_scalar_values"
    )
    const changedPatch = trigger.indexOf("into changed_values")
    const triggerPostPrune = trigger.lastIndexOf(
      "new.values := private.prune_template_scalar_values"
    )

    expect(triggerPrePrune).toBeGreaterThan(-1)
    expect(changedPatch).toBeGreaterThan(triggerPrePrune)
    expect(triggerPostPrune).toBeGreaterThan(changedPatch)
    expect(visibilitySql).toContain(
      "create trigger document_answers_apply_template_visibility before insert or update of values on public.document_answers"
    )

    const rpcPrePrune = mergeRpc.indexOf(
      "merged_values := private.prune_template_scalar_values"
    )
    const persistedPrePrune = mergeRpc.indexOf(
      "set values = merged_values",
      rpcPrePrune
    )
    const rpcPostPrune = mergeRpc.indexOf(
      "existing_values || target_values",
      persistedPrePrune
    )

    expect(rpcPrePrune).toBeGreaterThan(-1)
    expect(persistedPrePrune).toBeGreaterThan(rpcPrePrune)
    expect(rpcPostPrune).toBeGreaterThan(persistedPrePrune)
  })

  it("rejects hidden or unknown submission values through an independent trigger", () => {
    const validation = getFunctionSection(
      visibilitySql,
      "public.validate_internal_submission_values"
    )
    const trigger = getFunctionSection(
      visibilitySql,
      "private.enforce_submission_visibility"
    )

    expect(validation).toContain(
      "visible_scalar_values := private.prune_template_scalar_values"
    )
    expect(validation).toContain(
      "visible_scalar_values is distinct from target_values"
    )
    expect(visibilitySql).toContain(
      "create trigger submissions_validate_template_visibility before insert or update of values, status on public.submissions"
    )
    expect(trigger).toContain(
      "perform public.validate_internal_submission_values"
    )
    expect(trigger).toContain(
      "perform private.validate_visible_submission_requirements"
    )
    expect(trigger).toContain("submission_file.status = 'upload_pending'")
    expect(trigger).toContain("private.template_block_is_visible")
  })

  it("survives the later public-form update-guard replacement", () => {
    expect(laterPublicFormSql).toContain(
      "create or replace function public.enforce_submission_update()"
    )
    expect(laterPublicFormSql).not.toContain(
      "drop trigger submissions_validate_template_visibility"
    )
    expect(laterPublicFormSql).not.toContain(
      "drop trigger submissions_cleanup_hidden_files"
    )
    expect(laterPublicFormSql).not.toContain(
      "drop trigger submission_files_require_visible_field"
    )
  })

  it("makes both submission RPCs visibility-aware without changing their grants", () => {
    const submitRpc = getFunctionSection(
      visibilitySql,
      "public.submit_internal_submission"
    )
    const allocateRpc = getFunctionSection(
      visibilitySql,
      "public.allocate_internal_submission_file"
    )
    const completionRpc = getFunctionSection(
      visibilitySql,
      "public.complete_document_recipient_signature"
    )

    expect(submitRpc).toContain(
      "perform private.validate_visible_submission_requirements"
    )
    expect(submitRpc).toContain("private.template_block_is_visible")
    expect(allocateRpc).toContain("private.template_block_is_visible")
    expect(allocateRpc).toContain(
      "raise exception 'submission file field is currently hidden.'"
    )
    expect(completionRpc).toContain("private.template_block_is_visible")
    expect(visibilitySql).toContain(
      "grant execute on function public.submit_internal_submission"
    )
    expect(visibilitySql).toContain(
      "grant execute on function public.allocate_internal_submission_file"
    )
    expect(visibilitySql).not.toMatch(
      /grant execute on function public\.(submit_internal_submission|allocate_internal_submission_file|complete_document_recipient_signature)\([^;]+ to (anon|authenticated)/
    )
  })

  it("removes a public draft file only through exact active link and draft tokens", () => {
    const removalRpc = getFunctionSection(
      visibilitySql,
      "public.supersede_public_submission_file"
    )
    const fileGuard = getFunctionSection(
      visibilitySql,
      "public.enforce_submission_file_update"
    )

    expect(removalRpc).toContain("target_public_form_token text")
    expect(removalRpc).toContain("target_public_draft_token text")
    expect(removalRpc).toContain("target_file_id uuid")
    expect(removalRpc).toContain(
      "from public.public_form_links public_link"
    )
    expect(removalRpc).toContain(
      "public_link.token = target_public_form_token"
    )
    expect(removalRpc).toContain("public_link.status = 'active'")
    expect(removalRpc).toContain("public_link.expires_at > now()")
    expect(removalRpc).toContain(
      "to_jsonb(submission) ->> 'public_draft_token' = target_public_draft_token"
    )
    expect(removalRpc).toContain("submission.org_id = locked_org_id")
    expect(removalRpc).toContain("submission.status = 'draft'")
    expect(removalRpc).toContain(
      "submission_file.status in ('upload_pending', 'available')"
    )
    expect(removalRpc.match(/for update/g)).toHaveLength(3)
    expect(removalRpc).toContain("set status = 'superseded'")
    expect(removalRpc).toContain("superseded_by = null")
    expect(removalRpc).not.toContain("set cleanup_after")
    expect(removalRpc).toContain(
      "'bizzflow.public_file_removal_context'"
    )

    expect(fileGuard).toContain(
      "current_setting( 'bizzflow.public_file_removal_context', true )"
    )
    expect(fileGuard).toContain("actorless_public_removal")
    expect(fileGuard).toContain("public_link.status = 'active'")
    expect(fileGuard).toContain("public_link.expires_at > now()")
    expect(fileGuard).toContain(
      "and not actorless_visibility_cleanup and not actorless_public_removal"
    )

    expect(visibilitySql).toContain(
      "revoke all on function public.supersede_public_submission_file( text, text, uuid ) from public, anon, authenticated, service_role"
    )
    expect(visibilitySql).toContain(
      "grant execute on function public.supersede_public_submission_file( text, text, uuid ) to service_role"
    )
    expect(visibilitySql).not.toMatch(
      /grant execute on function public\.supersede_public_submission_file\([^;]+ to (anon|authenticated)/
    )
  })

  it("bounds hidden-file cleanup to the existing superseded lifecycle", () => {
    const cleanupTrigger = getFunctionSection(
      visibilitySql,
      "private.cleanup_hidden_submission_files"
    )
    const fileGuard = getFunctionSection(
      visibilitySql,
      "public.enforce_submission_file_update"
    )
    const fileBoundary = getFunctionSection(
      visibilitySql,
      "private.require_visible_submission_file_field"
    )

    expect(cleanupTrigger).toContain("set status = 'superseded'")
    expect(cleanupTrigger).toContain(
      "submission_file.status in ('upload_pending', 'available')"
    )
    expect(cleanupTrigger).toContain("and not exists")
    expect(fileBoundary).toContain("if file_block_count <> 1")
    expect(fileBoundary).toContain("private.template_block_is_visible")
    expect(fileGuard).toContain(
      "new.superseded_by is null and not actorless_visibility_cleanup"
    )
    expect(fileGuard).toContain(
      "to_jsonb(submission) ->> 'public_form_link_id' is not null"
    )
    expect(fileGuard).toContain("submission.created_by is null")
    expect(fileGuard).toContain("submission.updated_by is null")
    expect(fileGuard).toContain("submission.submitted_by is null")
    expect(fileGuard).toContain(
      "new.cleanup_after is distinct from old.cleanup_after"
    )
    expect(visibilitySql).toMatch(
      /update public\.submission_files submission_file set status = 'superseded'[^;]+submission_file\.status in \('upload_pending', 'available'\)[^;]+private\.template_block_is_visible/
    )
  })
})
