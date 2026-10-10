-- Templates get a Trash, as Files has. A trashed template is archived, so the
-- published view, public links and new documents already leave it out; it
-- remembers the status it had so Restore puts it back exactly. Deleting one
-- for good lets go of the documents made from it (each keeps its own
-- snapshot) and is refused while anyone has sent answers through it.
-- Expand only: new columns, constraints and functions, and one trigger that
-- now also allows that letting go.

alter table public.document_templates
  add column trashed_at timestamptz,
  add column trashed_by uuid references public.profiles (id) on delete set null,
  add column pre_trash_status text,
  add constraint document_templates_pre_trash_status_check
    check (pre_trash_status is null or pre_trash_status in ('draft', 'published', 'archived')),
  add constraint document_templates_trash_shape
    check ((trashed_at is null) = (pre_trash_status is null)),
  add constraint document_templates_trashed_archived
    check (trashed_at is null or status = 'archived');

create index document_templates_org_trashed_idx
  on public.document_templates (org_id)
  where trashed_at is not null;

create index document_templates_trashed_by_idx
  on public.document_templates (trashed_by)
  where trashed_by is not null;

-- A document's source stays as it was made, except that deleting its template
-- from Trash lets go of it: template and revision both become null, together,
-- while the template is still there and in Trash.
create or replace function public.prevent_document_snapshot_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(new.source_kind, new.template_id, new.template_revision)
      is distinct from
      row(old.source_kind, old.template_id, old.template_revision)
    and not (
      new.source_kind is not distinct from old.source_kind
      and old.template_id is not null
      and new.template_id is null
      and new.template_revision is null
      and exists (
        select 1
        from public.document_templates template
        where template.id = old.template_id
          and template.org_id = old.org_id
          and template.trashed_at is not null
      )
    ) then
    raise exception 'Generated document source snapshots are immutable.'
      using errcode = '23514';
  end if;

  if new.template_snapshot is distinct from old.template_snapshot
    and (
      old.source_kind is distinct from 'generated'
      or exists (
        select 1
        from public.document_answers answer
        where answer.document_id = old.id
          and answer.workflow_status <> 'draft'
      )
      or exists (
        select 1
        from public.document_signing_recipients recipient
        where recipient.document_id = old.id
      )
    ) then
    raise exception 'Generated document source snapshots are immutable.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Deletes one trashed template whose row the caller has locked. Pictures stay
-- in storage: documents made from the template share them.
create or replace function private.delete_trashed_document_template(
  target_org_id uuid,
  target_template_id uuid,
  target_actor_user_id uuid,
  target_request_kind text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_count integer;
begin
  -- Answered, or a document made from it sent to answer: its links belong to
  -- the template and would go with it.
  if exists (
    select 1
    from public.submissions submission
    where submission.org_id = target_org_id
      and submission.template_id = target_template_id
  ) or exists (
    select 1
    from public.public_form_links link
    where link.org_id = target_org_id
      and link.template_id = target_template_id
      and link.document_id is not null
  ) then
    raise exception 'People have answered this template or been sent documents made from it.'
      using errcode = 'P0001';
  end if;

  update public.documents document
  set template_id = null,
      template_revision = null
  where document.org_id = target_org_id
    and document.template_id = target_template_id;

  get diagnostics document_count = row_count;

  -- Versions, public links, Flow messages, access grants and editing rooms go with it.
  delete from public.document_templates template
  where template.id = target_template_id
    and template.org_id = target_org_id;

  insert into public.audit_logs (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    target_org_id,
    target_actor_user_id,
    'template.purged',
    'template',
    target_template_id,
    jsonb_build_object('requestKind', target_request_kind, 'documentCount', document_count)
  );
end;
$$;

-- Deletes one template from Trash for good, once its exact title is typed.
-- P0002: not in Trash here; 22023: the title did not match; P0001: answered.
create or replace function public.purge_trashed_document_template(
  target_org_id uuid,
  target_template_id uuid,
  target_actor_user_id uuid,
  target_confirmation_title text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_template public.document_templates%rowtype;
begin
  select *
  into locked_template
  from public.document_templates template
  where template.id = target_template_id
    and template.org_id = target_org_id
  for update;

  if not found or locked_template.trashed_at is null then
    raise exception 'Template is not in Trash.'
      using errcode = 'P0002';
  end if;

  if target_confirmation_title is distinct from locked_template.title then
    raise exception 'Template title confirmation does not match.'
      using errcode = '22023';
  end if;

  perform private.delete_trashed_document_template(
    locked_template.org_id,
    locked_template.id,
    target_actor_user_id,
    'manual'
  );
end;
$$;

-- Empties Trash of templates that have been there 30 days (the app's
-- TEMPLATE_TRASH_RETENTION_DAYS), leaving any that people answered.
create or replace function public.purge_due_trashed_document_templates(target_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due record;
  purged integer := 0;
begin
  if target_limit is null or target_limit < 1 or target_limit > 100 then
    raise exception 'target_limit must be between 1 and 100.'
      using errcode = '22023';
  end if;

  for due in
    select template.org_id, template.id
    from public.document_templates template
    where template.trashed_at <= now() - interval '30 days'
      and not exists (
        select 1
        from public.submissions submission
        where submission.org_id = template.org_id
          and submission.template_id = template.id
      )
      and not exists (
        select 1
        from public.public_form_links link
        where link.org_id = template.org_id
          and link.template_id = template.id
          and link.document_id is not null
      )
    order by template.trashed_at, template.id
    limit target_limit
    for update of template skip locked
  loop
    perform private.delete_trashed_document_template(due.org_id, due.id, null, 'retention');
    purged := purged + 1;
  end loop;

  return purged;
end;
$$;

revoke execute on function private.delete_trashed_document_template(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.purge_trashed_document_template(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.purge_due_trashed_document_templates(integer)
  from public, anon, authenticated;
grant execute on function public.purge_trashed_document_template(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.purge_due_trashed_document_templates(integer)
  to service_role;

notify pgrst, 'reload schema';
