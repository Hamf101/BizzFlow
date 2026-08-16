create table public.document_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'draft',
  revision integer not null default 1,
  content jsonb not null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  published_by uuid references public.profiles (id) on delete set null,
  archived_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  archived_at timestamptz,
  unique (id, org_id),
  constraint document_templates_title_trimmed_length
    check (title = btrim(title) and char_length(title) between 1 and 180),
  constraint document_templates_description_trimmed_length
    check (
      description is null
      or (description = btrim(description) and char_length(description) between 1 and 2000)
    ),
  constraint document_templates_status_check
    check (status in ('draft', 'published', 'archived')),
  constraint document_templates_revision_positive check (revision > 0),
  constraint document_templates_content_object
    check (
      jsonb_typeof(content) = 'object'
      and content ->> 'schemaVersion' = '1'
    ),
  constraint document_templates_published_state
    check (
      (status = 'draft' and published_at is null)
      or (status = 'published' and published_at is not null)
      or status = 'archived'
    ),
  constraint document_templates_archived_state
    check (
      (archived_at is null and status <> 'archived')
      or (archived_at is not null and status = 'archived')
    )
);

alter table public.documents
  add column source_kind text not null default 'upload',
  add column template_id uuid,
  add column template_revision integer,
  add column template_snapshot jsonb,
  add constraint documents_source_kind_check
    check (source_kind in ('upload', 'generated')),
  add constraint documents_template_revision_positive
    check (template_revision is null or template_revision > 0),
  add constraint documents_template_id_org_id_fkey
    foreign key (template_id, org_id)
    references public.document_templates (id, org_id),
  add constraint documents_generated_snapshot_check
    check (
      (
        source_kind = 'upload'
        and template_id is null
        and template_revision is null
        and template_snapshot is null
      )
      or
      (
        source_kind = 'generated'
        and template_snapshot is not null
        and jsonb_typeof(template_snapshot) = 'object'
        and template_snapshot ->> 'schemaVersion' = '1'
        and (
          (template_id is null and template_revision is null)
          or (template_id is not null and template_revision is not null)
        )
      )
    );

create table public.document_answers (
  document_id uuid primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  values jsonb not null default '{}'::jsonb,
  workflow_status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, org_id),
  constraint document_answers_document_id_org_id_fkey
    foreign key (document_id, org_id)
    references public.documents (id, org_id)
    on delete cascade,
  constraint document_answers_values_object
    check (jsonb_typeof(values) = 'object'),
  constraint document_answers_workflow_status_check
    check (workflow_status in ('draft', 'awaiting_signatures', 'completed'))
);

create table public.document_signing_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null,
  user_id uuid references public.profiles (id) on delete set null,
  name text not null,
  email text not null,
  requires_signature boolean not null default true,
  status text not null default 'pending',
  token_hash text not null unique,
  token_expires_at timestamptz not null,
  invited_at timestamptz not null default now(),
  viewed_at timestamptz,
  signed_at timestamptz,
  signature_data jsonb,
  initials_data jsonb,
  unique (id, org_id),
  constraint document_signing_recipients_document_id_org_id_fkey
    foreign key (document_id, org_id)
    references public.documents (id, org_id)
    on delete cascade,
  constraint document_signing_recipients_name_trimmed_length
    check (name = btrim(name) and char_length(name) between 1 and 160),
  constraint document_signing_recipients_email_normalized
    check (
      email = lower(btrim(email))
      and char_length(email) between 3 and 320
      and position('@' in email) > 1
    ),
  constraint document_signing_recipients_status_check
    check (status in ('pending', 'viewed', 'signed')),
  constraint document_signing_recipients_token_hash_sha256
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint document_signing_recipients_token_expiry
    check (token_expires_at > invited_at),
  constraint document_signing_recipients_viewed_state
    check (
      (status = 'pending' and viewed_at is null)
      or (status in ('viewed', 'signed') and viewed_at is not null)
    ),
  constraint document_signing_recipients_signed_state
    check (
      (status <> 'signed' and signed_at is null)
      or (status = 'signed' and signed_at is not null)
    ),
  constraint document_signing_recipients_signature_object
    check (signature_data is null or jsonb_typeof(signature_data) = 'object'),
  constraint document_signing_recipients_initials_object
    check (initials_data is null or jsonb_typeof(initials_data) = 'object'),
  constraint document_signing_recipients_required_signature
    check (
      status <> 'signed'
      or not requires_signature
      or signature_data is not null
    )
);

create table public.document_recent_accesses (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  document_id uuid not null,
  last_opened_at timestamptz not null default now(),
  primary key (org_id, user_id, document_id),
  constraint document_recent_accesses_document_id_org_id_fkey
    foreign key (document_id, org_id)
    references public.documents (id, org_id)
    on delete cascade
);

create index document_templates_org_status_updated_idx
  on public.document_templates (org_id, status, updated_at desc);

create index document_templates_org_title_idx
  on public.document_templates (org_id, lower(title));

create index document_templates_created_by_idx
  on public.document_templates (created_by);

create index document_templates_updated_by_idx
  on public.document_templates (updated_by);

create index document_templates_published_by_idx
  on public.document_templates (published_by);

create index document_templates_archived_by_idx
  on public.document_templates (archived_by);

create index documents_template_org_idx
  on public.documents (template_id, org_id)
  where template_id is not null;

create index documents_org_source_created_idx
  on public.documents (org_id, source_kind, created_at desc);

create index document_answers_org_workflow_updated_idx
  on public.document_answers (org_id, workflow_status, updated_at desc);

create index document_signing_recipients_document_status_idx
  on public.document_signing_recipients (document_id, org_id, status);

create unique index document_signing_recipients_document_email_unique
  on public.document_signing_recipients (document_id, lower(email));

create index document_signing_recipients_org_status_idx
  on public.document_signing_recipients (org_id, status, invited_at desc);

create index document_signing_recipients_user_idx
  on public.document_signing_recipients (user_id);

create index document_signing_recipients_token_expiry_idx
  on public.document_signing_recipients (token_expires_at)
  where status <> 'signed';

create index document_recent_accesses_org_user_opened_idx
  on public.document_recent_accesses (org_id, user_id, last_opened_at desc);

create index document_recent_accesses_user_idx
  on public.document_recent_accesses (user_id);

create index document_recent_accesses_document_org_idx
  on public.document_recent_accesses (document_id, org_id);

create or replace function public.enforce_document_template_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(new.title, new.description, new.content)
      is distinct from row(old.title, old.description, old.content) then
    if new.revision <> old.revision + 1 then
      raise exception 'Template content edits must increment revision by one.'
        using errcode = '23514';
    end if;
  elsif new.revision <> old.revision then
    raise exception 'Template revision can change only with editable content.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_document_snapshot_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(new.source_kind, new.template_id, new.template_revision, new.template_snapshot)
      is distinct from
      row(old.source_kind, old.template_id, old.template_revision, old.template_snapshot) then
    raise exception 'Generated document source snapshots are immutable.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_generated_document_answer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.documents document
    where document.id = new.document_id
      and document.org_id = new.org_id
      and document.source_kind = 'generated'
  ) then
    raise exception 'Document answers require a generated document.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_completed_document_answer_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.workflow_status = 'completed'
      and (
        new.values is distinct from old.values
        or new.workflow_status is distinct from old.workflow_status
      ) then
    raise exception 'Completed document answers are immutable.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.complete_document_recipient_signature(
  target_org_id uuid,
  target_document_id uuid,
  target_recipient_id uuid,
  target_token_hash text,
  target_values jsonb,
  target_signature_data jsonb,
  target_initials_data jsonb
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  answer_values jsonb;
  answer_status text;
  document_snapshot jsonb;
  merged_values jsonb;
  required_block jsonb;
  required_field_key text;
  recipient_requires_signature boolean;
  recipient_status text;
  recipient_token_expires_at timestamptz;
begin
  select answer.values, answer.workflow_status
  into answer_values, answer_status
  from public.document_answers answer
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Generated document answers were not found.'
      using errcode = 'P0002';
  end if;

  if target_values is null or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Document answer values must be a JSON object.'
      using errcode = '22023';
  end if;

  select document.template_snapshot
  into document_snapshot
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
    and document.source_kind = 'generated';

  if not found then
    raise exception 'Generated document snapshot was not found.'
      using errcode = 'P0002';
  end if;

  select recipient.requires_signature, recipient.status, recipient.token_expires_at
  into recipient_requires_signature, recipient_status, recipient_token_expires_at
  from public.document_signing_recipients recipient
  where recipient.id = target_recipient_id
    and recipient.document_id = target_document_id
    and recipient.org_id = target_org_id
    and recipient.token_hash = target_token_hash
  for update;

  if not found then
    raise exception 'Document signing recipient was not found.'
      using errcode = 'P0002';
  end if;

  if recipient_status = 'signed' then
    return answer_status;
  end if;

  if recipient_token_expires_at <= now() then
    raise exception 'Document signing token has expired.'
      using errcode = 'P0001';
  end if;

  if answer_status = 'completed' then
    raise exception 'Completed document answers are immutable.'
      using errcode = '23514';
  end if;

  if recipient_requires_signature and target_signature_data is null then
    raise exception 'A drawn signature is required.'
      using errcode = '22023';
  end if;

  merged_values := answer_values || target_values;

  -- Every signer locks the shared answer row first. This makes the final-signer
  -- completeness decision deterministic even when recipients submit together.
  if not exists (
    select 1
    from public.document_signing_recipients recipient
    where recipient.document_id = target_document_id
      and recipient.org_id = target_org_id
      and recipient.id <> target_recipient_id
      and recipient.requires_signature
      and recipient.status <> 'signed'
  ) then
    for required_block in
      select block
      from jsonb_array_elements(
        coalesce(
          document_snapshot #> '{sections,header,blocks}',
          '[]'::jsonb
        )
        || coalesce(
          document_snapshot #> '{sections,body,blocks}',
          '[]'::jsonb
        )
        || coalesce(
          document_snapshot #> '{sections,footer,blocks}',
          '[]'::jsonb
        )
      ) as required_blocks(block)
      where coalesce((block ->> 'required')::boolean, false)
        and block ->> 'type' not in ('signature_field', 'initials_field')
    loop
      required_field_key := required_block ->> 'fieldKey';

      if required_field_key is null or required_field_key = '' then
        raise exception 'Generated document snapshot contains an invalid required field.'
          using errcode = '23514';
      end if;

      if required_block ->> 'type' = 'checkbox_field' then
        if merged_values -> required_field_key is distinct from 'true'::jsonb then
          raise exception 'Required document fields must be completed before the final signature.'
            using errcode = '22023';
        end if;
      elsif jsonb_typeof(merged_values -> required_field_key) is distinct from 'string'
          or btrim(merged_values ->> required_field_key) = '' then
        raise exception 'Required document fields must be completed before the final signature.'
          using errcode = '22023';
      end if;
    end loop;
  end if;

  update public.document_signing_recipients recipient
  set status = 'signed',
      viewed_at = coalesce(recipient.viewed_at, now()),
      signed_at = now(),
      signature_data = target_signature_data,
      initials_data = target_initials_data
  where recipient.id = target_recipient_id
    and recipient.document_id = target_document_id
    and recipient.org_id = target_org_id;

  if exists (
    select 1
    from public.document_signing_recipients recipient
    where recipient.document_id = target_document_id
      and recipient.org_id = target_org_id
      and recipient.requires_signature
      and recipient.status <> 'signed'
  ) then
    answer_status := 'awaiting_signatures';
  else
    answer_status := 'completed';
  end if;

  update public.document_answers answer
  set values = merged_values,
      workflow_status = answer_status
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id;

  return answer_status;
end;
$$;

revoke all on function public.enforce_document_template_revision() from public;
revoke all on function public.prevent_document_snapshot_mutation() from public;
revoke all on function public.enforce_generated_document_answer() from public;
revoke all on function public.prevent_completed_document_answer_mutation() from public;
revoke all on function public.complete_document_recipient_signature(
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;

grant execute on function public.complete_document_recipient_signature(
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb
) to service_role;

create trigger document_templates_enforce_revision
  before update on public.document_templates
  for each row execute function public.enforce_document_template_revision();

create trigger document_templates_set_updated_at
  before update on public.document_templates
  for each row execute function public.set_updated_at();

create trigger documents_prevent_snapshot_mutation
  before update of source_kind, template_id, template_revision, template_snapshot
  on public.documents
  for each row execute function public.prevent_document_snapshot_mutation();

create trigger document_answers_require_generated
  before insert or update of document_id, org_id on public.document_answers
  for each row execute function public.enforce_generated_document_answer();

create trigger document_answers_prevent_completed_mutation
  before update on public.document_answers
  for each row execute function public.prevent_completed_document_answer_mutation();

create trigger document_answers_set_updated_at
  before update on public.document_answers
  for each row execute function public.set_updated_at();

alter table public.document_templates enable row level security;
alter table public.document_answers enable row level security;
alter table public.document_signing_recipients enable row level security;
alter table public.document_recent_accesses enable row level security;

alter table public.document_templates force row level security;
alter table public.document_answers force row level security;
alter table public.document_signing_recipients force row level security;
alter table public.document_recent_accesses force row level security;

grant usage on schema public to authenticated, service_role;

revoke all on table public.document_templates from anon;
revoke all on table public.document_answers from anon;
revoke all on table public.document_signing_recipients from anon;
revoke all on table public.document_recent_accesses from anon;

revoke insert, update, delete on table public.document_templates from authenticated;
revoke insert, update, delete on table public.document_answers from authenticated;
revoke insert, update, delete on table public.document_signing_recipients from authenticated;
revoke insert, update, delete on table public.document_recent_accesses from authenticated;

grant select on table public.document_templates to authenticated;
grant select on table public.document_answers to authenticated;
grant select on table public.document_signing_recipients to authenticated;
grant select on table public.document_recent_accesses to authenticated;

grant select, insert, update on table public.document_templates to service_role;
grant select, insert, update on table public.document_answers to service_role;
grant select, insert, update, delete on table public.document_signing_recipients to service_role;
grant select, insert, update, delete on table public.document_recent_accesses to service_role;

create policy document_templates_select_published_member
  on public.document_templates
  for select
  to authenticated
  using (
    status = 'published'
    and (select public.is_organization_member(org_id))
  );

create policy document_answers_select_member
  on public.document_answers
  for select
  to authenticated
  using ((select public.is_organization_member(org_id)));

create policy document_signing_recipients_select_member
  on public.document_signing_recipients
  for select
  to authenticated
  using ((select public.is_organization_member(org_id)));

create policy document_recent_accesses_select_own
  on public.document_recent_accesses
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_organization_member(org_id))
  );

notify pgrst, 'reload schema';
