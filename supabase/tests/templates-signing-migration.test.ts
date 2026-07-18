import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getAuthenticatedWriteGrantStatements,
  getMigrationPath,
  getTableDefinition,
  normalizeSql,
} from "./migration-contract-helpers"

const documentTemplatesMigrationPath = getMigrationPath(
  "20260717205037_document_templates_signing_recents.sql"
)
const templateDomainTables = [
  "document_templates",
  "document_answers",
  "document_signing_recipients",
  "document_recent_accesses",
] as const

describe("Document templates, signing, and recents migration", () => {
  it("creates versioned templates and immutable generated document snapshots", () => {
    const migrationSql = readFileSync(documentTemplatesMigrationPath, "utf8")
    const templateSql = getTableDefinition(migrationSql, "document_templates")
    const sql = normalizeSql(migrationSql)

    expect(templateSql).toContain("unique (id, org_id)")
    expect(templateSql).toContain("status in ('draft', 'published', 'archived')")
    expect(templateSql).toContain("revision integer not null default 1")
    expect(templateSql).toContain("content jsonb not null")
    expect(templateSql).toContain("content ->> 'schemaVersion' = '1'")
    expect(migrationSql).toContain("add column source_kind text not null default 'upload'")
    expect(migrationSql).toContain("add column template_id uuid")
    expect(migrationSql).toContain("add column template_revision integer")
    expect(migrationSql).toContain("add column template_snapshot jsonb")
    expect(migrationSql).toContain("source_kind in ('upload', 'generated')")
    expect(migrationSql).toContain("constraint documents_generated_snapshot_check")
    expect(sql).toContain(
      "create trigger documents_prevent_snapshot_mutation before update of source_kind, template_id, template_revision, template_snapshot"
    )
    expect(sql).toContain("template content edits must increment revision by one.")
  })

  it("creates tenant-scoped answers, hashed signing recipients, and atomic recents", () => {
    const migrationSql = readFileSync(documentTemplatesMigrationPath, "utf8")
    const answersSql = getTableDefinition(migrationSql, "document_answers")
    const recipientsSql = getTableDefinition(
      migrationSql,
      "document_signing_recipients"
    )
    const recentsSql = getTableDefinition(
      migrationSql,
      "document_recent_accesses"
    )

    expect(answersSql).toContain("document_id uuid primary key")
    expect(answersSql).toContain("jsonb_typeof(values) = 'object'")
    expect(answersSql).toContain(
      "workflow_status in ('draft', 'awaiting_signatures', 'completed')"
    )
    expect(recipientsSql).toContain("token_hash text not null unique")
    expect(recipientsSql).toContain("token_hash ~ '^[0-9a-f]{64}$'")
    expect(recipientsSql).not.toMatch(/\btoken\s+text\b/)
    expect(recipientsSql).toContain("signature_data jsonb")
    expect(recipientsSql).toContain("initials_data jsonb")
    expect(recentsSql).toContain("primary key (org_id, user_id, document_id)")
    expect(migrationSql).toContain(
      "on public.document_recent_accesses (org_id, user_id, last_opened_at desc)"
    )
    expect(migrationSql).toContain(
      "on public.document_signing_recipients (document_id, org_id, status)"
    )
  })

  it("enables forced RLS, own-user recents, and published member template reads", () => {
    const migrationSql = readFileSync(documentTemplatesMigrationPath, "utf8")

    templateDomainTables.forEach(
      (tableName: (typeof templateDomainTables)[number]): void => {
        expect(migrationSql).toContain(
          `alter table public.${tableName} enable row level security`
        )
        expect(migrationSql).toContain(
          `alter table public.${tableName} force row level security`
        )
      }
    )

    expect(migrationSql).toContain("create policy document_templates_select_published_member")
    expect(migrationSql).toContain("status = 'published'")
    expect(migrationSql).toContain("create policy document_answers_select_member")
    expect(migrationSql).toContain(
      "create policy document_signing_recipients_select_member"
    )
    expect(migrationSql).toContain("create policy document_recent_accesses_select_own")
    expect(migrationSql).toContain("user_id = (select auth.uid())")
    expect(migrationSql).toContain("(select public.is_organization_member(org_id))")
  })

  it("keeps authenticated writes revoked and grants only explicit service operations", () => {
    const migrationSql = readFileSync(documentTemplatesMigrationPath, "utf8")

    templateDomainTables.forEach(
      (tableName: (typeof templateDomainTables)[number]): void => {
        expect(migrationSql).toContain(`revoke all on table public.${tableName} from anon`)
        expect(migrationSql).toContain(
          `revoke insert, update, delete on table public.${tableName} from authenticated`
        )
        expect(migrationSql).toContain(
          `grant select on table public.${tableName} to authenticated`
        )
      }
    )

    expect(
      getAuthenticatedWriteGrantStatements(migrationSql, templateDomainTables)
    ).toEqual([])
    expect(migrationSql).toContain(
      "grant select, insert, update on table public.document_templates to service_role"
    )
    expect(migrationSql).toContain(
      "grant select, insert, update on table public.document_answers to service_role"
    )
    expect(migrationSql).toContain(
      "grant select, insert, update, delete on table public.document_signing_recipients to service_role"
    )
    expect(migrationSql).toContain(
      "grant select, insert, update, delete on table public.document_recent_accesses to service_role"
    )
  })

  it("freezes completed answers and completes only after every required signer", () => {
    const sql = normalizeSql(
      readFileSync(documentTemplatesMigrationPath, "utf8")
    )
    const signature =
      "create or replace function public.complete_document_recipient_signature( target_org_id uuid, target_document_id uuid, target_recipient_id uuid, target_token_hash text, target_values jsonb, target_signature_data jsonb, target_initials_data jsonb ) returns text language plpgsql security invoker set search_path = ''"

    expect(sql).toContain("completed document answers are immutable.")
    expect(sql).toContain("create trigger document_answers_prevent_completed_mutation")
    expect(sql).toContain(signature)
    expect(sql).toContain(
      "from public.document_answers answer where answer.document_id = target_document_id and answer.org_id = target_org_id for update"
    )
    expect(sql).toContain(
      "and recipient.requires_signature and recipient.status <> 'signed'"
    )
    expect(sql).toContain("and recipient.id <> target_recipient_id")
    expect(sql).toContain(
      "required document fields must be completed before the final signature."
    )
    expect(sql).toContain(
      "document_snapshot #> '{sections,header,blocks}'"
    )
    expect(sql).toContain("answer_status := 'awaiting_signatures'")
    expect(sql).toContain("answer_status := 'completed'")
    expect(sql).toContain("merged_values := answer_values || target_values")
    expect(sql).toContain("set values = merged_values")
    expect(sql).toContain(
      "create unique index document_signing_recipients_document_email_unique on public.document_signing_recipients (document_id, lower(email))"
    )
    expect(sql).toContain(
      "revoke all on function public.complete_document_recipient_signature( uuid, uuid, uuid, text, jsonb, jsonb, jsonb ) from public, anon, authenticated"
    )
    expect(sql).toContain(
      "grant execute on function public.complete_document_recipient_signature( uuid, uuid, uuid, text, jsonb, jsonb, jsonb ) to service_role"
    )
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})
