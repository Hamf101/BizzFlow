create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  template_id uuid not null,
  template_revision integer not null,
  template_snapshot jsonb not null,
  values jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  revision integer not null default 1,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  submitted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique (id, org_id),
  constraint submissions_template_id_org_id_fkey
    foreign key (template_id, org_id)
    references public.document_templates (id, org_id),
  constraint submissions_title_trimmed_length
    check (title = btrim(title) and char_length(title) between 1 and 180),
  constraint submissions_template_revision_positive
    check (template_revision > 0),
  constraint submissions_template_snapshot_object
    check (
      jsonb_typeof(template_snapshot) = 'object'
      and template_snapshot ->> 'schemaVersion' = '1'
    ),
  constraint submissions_values_object
    check (jsonb_typeof(values) = 'object'),
  constraint submissions_status_check
    check (status in ('draft', 'submitted')),
  constraint submissions_revision_positive
    check (revision > 0),
  constraint submissions_state_check
    check (
      (
        status = 'draft'
        and submitted_by is null
        and submitted_at is null
      )
      or
      (
        status = 'submitted'
        and submitted_at is not null
      )
    )
);

create table public.submission_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  submission_id uuid not null,
  field_key text not null,
  status text not null default 'upload_pending',
  storage_key text not null unique,
  original_filename text not null,
  safe_filename text not null,
  content_type text not null,
  byte_size bigint not null,
  checksum_sha256 text,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  available_at timestamptz,
  unique (id, org_id),
  unique (submission_id, field_key),
  constraint submission_files_submission_id_org_id_fkey
    foreign key (submission_id, org_id)
    references public.submissions (id, org_id)
    on delete cascade,
  constraint submission_files_field_key_format
    check (field_key ~ '^[A-Za-z][A-Za-z0-9_-]{0,79}$'),
  constraint submission_files_status_check
    check (status in ('upload_pending', 'available')),
  constraint submission_files_original_filename_trimmed_length
    check (
      original_filename = btrim(original_filename)
      and char_length(original_filename) between 1 and 240
    ),
  constraint submission_files_safe_filename_format
    check (
      char_length(safe_filename) between 1 and 180
      and safe_filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    ),
  constraint submission_files_content_type_check
    check (
      content_type in (
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv'
      )
    ),
  constraint submission_files_byte_size_check
    check (byte_size between 1 and 20971520),
  constraint submission_files_checksum_sha256_check
    check (
      checksum_sha256 is null
      or checksum_sha256 ~ '^[0-9a-f]{64}$'
    ),
  constraint submission_files_storage_key_check
    check (
      storage_key =
        'organizations/' || org_id::text ||
        '/submissions/' || submission_id::text ||
        '/files/' || field_key ||
        '/' || id::text ||
        '/' || safe_filename
    ),
  constraint submission_files_state_check
    check (
      (
        status = 'upload_pending'
        and checksum_sha256 is null
        and available_at is null
      )
      or
      (
        status = 'available'
        and available_at is not null
      )
    )
);

create index submissions_org_creator_updated_idx
  on public.submissions (org_id, created_by, updated_at desc, id);

create index submissions_org_status_updated_idx
  on public.submissions (org_id, status, updated_at desc, id);

create index submissions_template_org_idx
  on public.submissions (template_id, org_id);

create index submissions_created_by_idx
  on public.submissions (created_by);

create index submissions_updated_by_idx
  on public.submissions (updated_by);

create index submissions_submitted_by_idx
  on public.submissions (submitted_by)
  where submitted_by is not null;

create index submission_files_submission_org_idx
  on public.submission_files (submission_id, org_id);

create index submission_files_org_status_updated_idx
  on public.submission_files (org_id, status, updated_at desc, id);

create index submission_files_uploaded_by_idx
  on public.submission_files (uploaded_by)
  where uploaded_by is not null;

create or replace function public.enforce_submission_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_by_cleanup boolean;
  updated_by_cleanup boolean;
  submitted_by_cleanup boolean;
  substantive_change boolean;
begin
  created_by_cleanup :=
    new.created_by is not distinct from old.created_by
    or (old.created_by is not null and new.created_by is null);
  updated_by_cleanup :=
    new.updated_by is not distinct from old.updated_by
    or (old.updated_by is not null and new.updated_by is null);
  submitted_by_cleanup :=
    new.submitted_by is not distinct from old.submitted_by
    or (old.submitted_by is not null and new.submitted_by is null);

  if new.id is distinct from old.id
      or new.org_id is distinct from old.org_id
      or new.title is distinct from old.title
      or new.template_id is distinct from old.template_id
      or new.template_revision is distinct from old.template_revision
      or new.template_snapshot is distinct from old.template_snapshot
      or not created_by_cleanup
      or new.created_at is distinct from old.created_at then
    raise exception 'Template snapshot identity is immutable.'
      using errcode = '23514';
  end if;

  if old.status = 'submitted' then
    if new.values is distinct from old.values
        or new.status is distinct from old.status
        or new.revision is distinct from old.revision
        or new.updated_at is distinct from old.updated_at
        or new.submitted_at is distinct from old.submitted_at
        or not updated_by_cleanup
        or not submitted_by_cleanup then
      raise exception 'Submitted submissions are immutable.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.status = 'submitted' and new.submitted_by is null then
    raise exception 'A submission actor is required for submission.'
      using errcode = '23514';
  end if;

  substantive_change :=
    new.values is distinct from old.values
    or new.status is distinct from old.status
    or new.updated_at is distinct from old.updated_at
    or new.submitted_at is distinct from old.submitted_at;

  if substantive_change and new.revision <> old.revision + 1 then
    raise exception 'Submission revision must advance exactly once.'
      using errcode = '23514';
  end if;

  if not substantive_change and new.revision <> old.revision then
    raise exception 'Submission revision cannot change without content.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_submission_file_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uploaded_by_cleanup boolean;
begin
  uploaded_by_cleanup :=
    new.uploaded_by is not distinct from old.uploaded_by
    or (old.uploaded_by is not null and new.uploaded_by is null);

  if new.id is distinct from old.id
      or new.org_id is distinct from old.org_id
      or new.submission_id is distinct from old.submission_id
      or new.field_key is distinct from old.field_key
      or new.storage_key is distinct from old.storage_key
      or new.original_filename is distinct from old.original_filename
      or new.safe_filename is distinct from old.safe_filename
      or new.content_type is distinct from old.content_type
      or new.byte_size is distinct from old.byte_size
      or new.created_at is distinct from old.created_at
      or not uploaded_by_cleanup then
    raise exception 'Submission file identity is immutable.'
      using errcode = '23514';
  end if;

  if old.status = 'available' then
    if new.status is distinct from old.status
        or new.checksum_sha256 is distinct from old.checksum_sha256
        or new.updated_at is distinct from old.updated_at
        or new.available_at is distinct from old.available_at then
      raise exception 'Available submission files are immutable.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.status = 'upload_pending'
      and new.checksum_sha256 is not distinct from old.checksum_sha256
      and new.updated_at is not distinct from old.updated_at
      and new.available_at is not distinct from old.available_at then
    -- Permit only the `on delete set null` uploader cleanup on pending rows.
    return new;
  end if;

  if new.status <> 'available' then
    raise exception 'Submission files may only transition to available.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_submission_update()
  from public, anon, authenticated, service_role;

revoke all on function public.enforce_submission_file_update()
  from public, anon, authenticated, service_role;

create trigger submissions_enforce_update
  before update on public.submissions
  for each row execute function public.enforce_submission_update();

create trigger submission_files_enforce_update
  before update on public.submission_files
  for each row execute function public.enforce_submission_file_update();

alter table public.submissions enable row level security;
alter table public.submissions force row level security;
alter table public.submission_files enable row level security;
alter table public.submission_files force row level security;

grant usage on schema public to authenticated, service_role;

revoke all on table public.submissions
  from anon, authenticated, service_role;
revoke all on table public.submission_files
  from anon, authenticated, service_role;

grant select on table public.submissions to authenticated;
grant select on table public.submission_files to authenticated;

grant select, insert, update on table public.submissions to service_role;
grant select, insert, update on table public.submission_files to service_role;

create policy submissions_select_internal_member
  on public.submissions
  for select
  to authenticated
  using (
    (select public.organization_role_for(org_id)) in ('owner_admin', 'manager')
    or (
      (select public.organization_role_for(org_id)) = 'staff'
      and created_by = (select auth.uid())
    )
  );

create policy submission_files_select_internal_member
  on public.submission_files
  for select
  to authenticated
  using (
    (select public.organization_role_for(org_id)) in ('owner_admin', 'manager')
    or (
      (select public.organization_role_for(org_id)) = 'staff'
      and exists (
        select 1
        from public.submissions submission
        where submission.id = submission_files.submission_id
          and submission.org_id = submission_files.org_id
          and submission.created_by = (select auth.uid())
      )
    )
  );

create or replace function public.assert_internal_submission_actor(
  target_org_id uuid,
  target_actor_user_id uuid
)
returns public.organization_role
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_role public.organization_role;
begin
  select membership.role
  into actor_role
  from public.organization_memberships membership
  where membership.org_id = target_org_id
    and membership.user_id = target_actor_user_id
    and membership.status = 'active';

  if not found
      or actor_role not in ('owner_admin', 'manager', 'staff') then
    raise exception 'An active internal organization membership is required.'
      using errcode = '42501';
  end if;

  return actor_role;
end;
$$;

create or replace function public.validate_internal_submission_values(
  target_template_snapshot jsonb,
  target_values jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  answer record;
  matching_block jsonb;
  answer_text text;
begin
  if target_values is null or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Submission values must be a JSON object.'
      using errcode = '22023';
  end if;

  for answer in
    select entry.key, entry.value
    from jsonb_each(target_values) entry
  loop
    select block
    into matching_block
    from (
      select jsonb_array_elements(
        coalesce(target_template_snapshot #> '{sections,header,blocks}', '[]'::jsonb)
      ) as block
      union all
      select jsonb_array_elements(
        coalesce(target_template_snapshot #> '{sections,body,blocks}', '[]'::jsonb)
      ) as block
      union all
      select jsonb_array_elements(
        coalesce(target_template_snapshot #> '{sections,footer,blocks}', '[]'::jsonb)
      ) as block
    ) blocks
    where block ->> 'fieldKey' = answer.key
    limit 1;

    if matching_block is null
        or matching_block ->> 'type' = 'file_field' then
      raise exception 'Submission value % is not a scalar field in this snapshot.', answer.key
        using errcode = '22023';
    end if;

    if matching_block ->> 'type' = 'checkbox_field' then
      if jsonb_typeof(answer.value) <> 'boolean' then
        raise exception 'Submission field % must be a boolean.', answer.key
          using errcode = '22023';
      end if;

      continue;
    end if;

    if jsonb_typeof(answer.value) <> 'string' then
      raise exception 'Submission field % must be text.', answer.key
        using errcode = '22023';
    end if;

    answer_text := answer.value #>> '{}';

    if char_length(answer_text) > 20000 then
      raise exception 'Submission field % is too long.', answer.key
        using errcode = '22023';
    end if;

    if matching_block ->> 'type' = 'date_field'
        and answer_text <> ''
        and (
          answer_text !~ '^\d{4}-\d{2}-\d{2}$'
          or to_char(to_date(answer_text, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> answer_text
        ) then
      raise exception 'Submission field % must be a valid date.', answer.key
        using errcode = '22023';
    end if;

    if matching_block ->> 'type' = 'dropdown_field'
        and answer_text <> ''
        and not coalesce((matching_block -> 'options') ? answer_text, false) then
      raise exception 'Submission field % must use an available option.', answer.key
        using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function public.assert_internal_submission_actor(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.validate_internal_submission_values(jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function public.assert_internal_submission_actor(uuid, uuid)
  to service_role;
grant execute on function public.validate_internal_submission_values(jsonb, jsonb)
  to service_role;

create or replace function public.create_internal_submission_draft(
  target_org_id uuid,
  target_template_id uuid,
  target_submission_id uuid,
  target_title text,
  target_actor_user_id uuid
)
returns public.submissions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  template record;
  prepared_submission public.submissions%rowtype;
  inserted_count integer;
begin
  if target_org_id is null
      or target_template_id is null
      or target_submission_id is null
      or target_actor_user_id is null
      or target_title is null
      or target_title <> btrim(target_title)
      or char_length(target_title) not between 1 and 180 then
    raise exception 'Valid submission identifiers and title are required.'
      using errcode = '22023';
  end if;

  perform public.assert_internal_submission_actor(
    target_org_id,
    target_actor_user_id
  );

  select
    template.id,
    template.revision,
    template.content
  into template
  from public.document_templates template
  where template.id = target_template_id
    and template.org_id = target_org_id
    and template.status = 'published'
  for share;

  if not found then
    raise exception 'Published submission template was not found.'
      using errcode = 'P0002';
  end if;

  insert into public.submissions (
    id,
    org_id,
    title,
    template_id,
    template_revision,
    template_snapshot,
    values,
    status,
    revision,
    created_by,
    updated_by
  )
  values (
    target_submission_id,
    target_org_id,
    target_title,
    target_template_id,
    template.revision,
    template.content,
    '{}'::jsonb,
    'draft',
    1,
    target_actor_user_id,
    target_actor_user_id
  )
  on conflict (id) do nothing
  returning * into prepared_submission;

  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    select submission.*
    into prepared_submission
    from public.submissions submission
    where submission.id = target_submission_id
    for update;

    if not found
        or prepared_submission.org_id <> target_org_id
        or prepared_submission.template_id <> target_template_id
        or prepared_submission.title <> target_title
        or prepared_submission.created_by is null
        or prepared_submission.created_by <> target_actor_user_id then
      raise exception 'Submission identifier is already in use.'
        using errcode = '23505';
    end if;

    return prepared_submission;
  end if;

  insert into public.audit_logs (
    id,
    org_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    gen_random_uuid(),
    target_org_id,
    target_actor_user_id,
    'submission.created',
    'submission',
    target_submission_id,
    jsonb_build_object(
      'templateId', target_template_id,
      'templateRevision', template.revision
    )
  );

  return prepared_submission;
end;
$$;

create or replace function public.save_internal_submission_draft(
  target_org_id uuid,
  target_submission_id uuid,
  target_expected_revision integer,
  target_values jsonb,
  target_actor_user_id uuid
)
returns public.submissions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_submission public.submissions%rowtype;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_actor_user_id is null
      or target_expected_revision is null
      or target_expected_revision < 1
      or target_values is null
      or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Valid draft values and revision are required.'
      using errcode = '22023';
  end if;

  perform public.assert_internal_submission_actor(
    target_org_id,
    target_actor_user_id
  );

  select submission.*
  into locked_submission
  from public.submissions submission
  where submission.id = target_submission_id
    and submission.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Submission draft was not found.'
      using errcode = 'P0002';
  end if;

  -- This null-safe check enforces `submission.created_by <> target_actor_user_id`.
  if locked_submission.created_by is null
      or locked_submission.created_by <> target_actor_user_id then
    raise exception 'Only the submission creator may edit this draft.'
      using errcode = '42501';
  end if;

  if locked_submission.status <> 'draft' then
    raise exception 'Submitted submissions cannot be edited.'
      using errcode = 'P0001';
  end if;

  if locked_submission.revision <> target_expected_revision then
    if locked_submission.revision = target_expected_revision + 1
        and locked_submission.values = target_values
        and locked_submission.updated_by = target_actor_user_id then
      return locked_submission;
    end if;

    raise exception 'Submission draft has changed. Reload and try again.'
      using errcode = '40001';
  end if;

  perform public.validate_internal_submission_values(
    locked_submission.template_snapshot,
    target_values
  );

  update public.submissions submission
  set values = target_values,
      revision = submission.revision + 1,
      updated_by = target_actor_user_id,
      updated_at = now()
  where submission.id = target_submission_id
    and submission.org_id = target_org_id
  returning submission.* into locked_submission;

  return locked_submission;
end;
$$;

create or replace function public.allocate_internal_submission_file(
  target_org_id uuid,
  target_submission_id uuid,
  target_expected_revision integer,
  target_file_id uuid,
  target_field_key text,
  target_original_filename text,
  target_safe_filename text,
  target_content_type text,
  target_byte_size bigint,
  target_storage_key text,
  target_actor_user_id uuid
)
returns public.submission_files
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_submission public.submissions%rowtype;
  prepared_file public.submission_files%rowtype;
  expected_storage_key text;
  file_block jsonb;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_expected_revision is null
      or target_expected_revision < 1
      or target_file_id is null
      or target_field_key is null
      or target_original_filename is null
      or target_safe_filename is null
      or target_content_type is null
      or target_byte_size is null
      or target_actor_user_id is null then
    raise exception 'Complete submission file metadata is required.'
      using errcode = '22023';
  end if;

  perform public.assert_internal_submission_actor(
    target_org_id,
    target_actor_user_id
  );

  select submission.*
  into locked_submission
  from public.submissions submission
  where submission.id = target_submission_id
    and submission.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Submission draft was not found.'
      using errcode = 'P0002';
  end if;

  -- This null-safe check enforces `submission.created_by <> target_actor_user_id`.
  if locked_submission.created_by is null
      or locked_submission.created_by <> target_actor_user_id then
    raise exception 'Only the submission creator may upload draft files.'
      using errcode = '42501';
  end if;

  if locked_submission.status <> 'draft' then
    raise exception 'Files cannot be added after submission.'
      using errcode = 'P0001';
  end if;

  if locked_submission.revision <> target_expected_revision then
    raise exception 'Submission draft has changed. Reload and try again.'
      using errcode = '40001';
  end if;

  select block
  into file_block
  from (
    select jsonb_array_elements(
      coalesce(locked_submission.template_snapshot #> '{sections,header,blocks}', '[]'::jsonb)
    ) as block
    union all
    select jsonb_array_elements(
      coalesce(locked_submission.template_snapshot #> '{sections,body,blocks}', '[]'::jsonb)
    ) as block
    union all
    select jsonb_array_elements(
      coalesce(locked_submission.template_snapshot #> '{sections,footer,blocks}', '[]'::jsonb)
    ) as block
  ) blocks
  where block ->> 'type' = 'file_field'
    and block ->> 'fieldKey' = target_field_key
  limit 1;

  if file_block is null then
    raise exception 'Submission file field was not found.'
      using errcode = '22023';
  end if;

  if target_original_filename <> btrim(target_original_filename)
      or char_length(target_original_filename) not between 1 and 240
      or char_length(target_safe_filename) not between 1 and 180
      or target_safe_filename !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
      or target_content_type not in (
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv'
      )
      or target_byte_size not between 1 and 20971520 then
    raise exception 'Submission file metadata is invalid.'
      using errcode = '22023';
  end if;

  expected_storage_key :=
    'organizations/' || target_org_id::text ||
    '/submissions/' || target_submission_id::text ||
    '/files/' || target_field_key ||
    '/' || target_file_id::text ||
    '/' || target_safe_filename;

  if target_storage_key is distinct from expected_storage_key then
    raise exception 'Submission file storage key is invalid.'
      using errcode = '22023';
  end if;

  select submission_file.*
  into prepared_file
  from public.submission_files submission_file
  where submission_file.submission_id = target_submission_id
    and submission_file.org_id = target_org_id
    and submission_file.field_key = target_field_key
  for update;

  if found then
    if prepared_file.id = target_file_id
        and prepared_file.storage_key = target_storage_key
        and prepared_file.original_filename = target_original_filename
        and prepared_file.safe_filename = target_safe_filename
        and prepared_file.content_type = target_content_type
        and prepared_file.byte_size = target_byte_size
        and prepared_file.uploaded_by = target_actor_user_id then
      return prepared_file;
    end if;

    raise exception 'This submission field already has a file allocation.'
      using errcode = '23505';
  end if;

  insert into public.submission_files (
    id,
    org_id,
    submission_id,
    field_key,
    status,
    storage_key,
    original_filename,
    safe_filename,
    content_type,
    byte_size,
    uploaded_by
  )
  values (
    target_file_id,
    target_org_id,
    target_submission_id,
    target_field_key,
    'upload_pending',
    target_storage_key,
    target_original_filename,
    target_safe_filename,
    target_content_type,
    target_byte_size,
    target_actor_user_id
  )
  returning * into prepared_file;

  return prepared_file;
end;
$$;

create or replace function public.complete_internal_submission_file(
  target_org_id uuid,
  target_submission_id uuid,
  target_file_id uuid,
  target_storage_key text,
  target_content_type text,
  target_byte_size bigint,
  target_checksum_sha256 text,
  target_actor_user_id uuid
)
returns public.submission_files
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_submission public.submissions%rowtype;
  locked_file public.submission_files%rowtype;
  submission_file_status text;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_file_id is null
      or target_storage_key is null
      or target_content_type is null
      or target_byte_size is null
      or target_actor_user_id is null
      or (
        target_checksum_sha256 is not null
        and target_checksum_sha256 !~ '^[0-9a-f]{64}$'
      ) then
    raise exception 'Verified submission file metadata is required.'
      using errcode = '22023';
  end if;

  perform public.assert_internal_submission_actor(
    target_org_id,
    target_actor_user_id
  );

  select submission.*
  into locked_submission
  from public.submissions submission
  where submission.id = target_submission_id
    and submission.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Submission draft was not found.'
      using errcode = 'P0002';
  end if;

  if locked_submission.created_by is null
      or locked_submission.created_by <> target_actor_user_id then
    raise exception 'Only the submission creator may complete draft files.'
      using errcode = '42501';
  end if;

  if locked_submission.status <> 'draft' then
    raise exception 'Files cannot be completed after submission.'
      using errcode = 'P0001';
  end if;

  select submission_file.*
  into locked_file
  from public.submission_files submission_file
  where submission_file.id = target_file_id
    and submission_file.submission_id = target_submission_id
    and submission_file.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Submission file allocation was not found.'
      using errcode = 'P0002';
  end if;

  submission_file_status := locked_file.status;

  if locked_file.storage_key <> target_storage_key
      or locked_file.content_type <> target_content_type
      or locked_file.byte_size <> target_byte_size then
    raise exception 'Uploaded object metadata does not match its allocation.'
      using errcode = '22023';
  end if;

  if submission_file_status = 'available' then
    if locked_file.checksum_sha256 is not distinct from target_checksum_sha256 then
      return locked_file;
    end if;

    raise exception 'Completed submission file metadata cannot change.'
      using errcode = 'P0001';
  end if;

  update public.submission_files submission_file
  set status = 'available',
      checksum_sha256 = target_checksum_sha256,
      updated_at = now(),
      available_at = now()
  where submission_file.id = target_file_id
    and submission_file.submission_id = target_submission_id
    and submission_file.org_id = target_org_id
  returning submission_file.* into locked_file;

  return locked_file;
end;
$$;

create or replace function public.submit_internal_submission(
  target_org_id uuid,
  target_submission_id uuid,
  target_expected_revision integer,
  target_values jsonb,
  target_actor_user_id uuid
)
returns public.submissions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_submission public.submissions%rowtype;
  required_block jsonb;
  required_value jsonb;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_actor_user_id is null
      or target_expected_revision is null
      or target_expected_revision < 1
      or target_values is null
      or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Valid submission values and revision are required.'
      using errcode = '22023';
  end if;

  perform public.assert_internal_submission_actor(
    target_org_id,
    target_actor_user_id
  );

  select submission.*
  into locked_submission
  from public.submissions submission
  where submission.id = target_submission_id
    and submission.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Submission was not found.'
      using errcode = 'P0002';
  end if;

  if locked_submission.created_by is null
      or locked_submission.created_by <> target_actor_user_id then
    raise exception 'Only the submission creator may submit this draft.'
      using errcode = '42501';
  end if;

  -- Idempotent retries return before revision checks or duplicate audit writes.
  if locked_submission.status = 'submitted' then
    if locked_submission.values = target_values
        and locked_submission.submitted_by = target_actor_user_id then
      return locked_submission;
    end if;

    raise exception 'Submitted submissions are immutable.'
      using errcode = 'P0001';
  end if;

  if locked_submission.revision <> target_expected_revision then
    raise exception 'Submission draft has changed. Reload and try again.'
      using errcode = '40001';
  end if;

  perform public.validate_internal_submission_values(
    locked_submission.template_snapshot,
    target_values
  );

  if exists (
    select 1
    from public.submission_files submission_file
    where submission_file.submission_id = target_submission_id
      and submission_file.org_id = target_org_id
      and submission_file.status = 'upload_pending'
  ) then
    raise exception 'Wait for pending file uploads before submitting.'
      using errcode = 'P0001';
  end if;

  for required_block in
    select block
    from (
      select jsonb_array_elements(
        coalesce(locked_submission.template_snapshot #> '{sections,header,blocks}', '[]'::jsonb)
      ) as block
      union all
      select jsonb_array_elements(
        coalesce(locked_submission.template_snapshot #> '{sections,body,blocks}', '[]'::jsonb)
      ) as block
      union all
      select jsonb_array_elements(
        coalesce(locked_submission.template_snapshot #> '{sections,footer,blocks}', '[]'::jsonb)
      ) as block
    ) blocks
    where coalesce((block ->> 'required')::boolean, false)
  loop
    if required_block ->> 'type' = 'file_field' then
      if not exists (
        select 1
        from public.submission_files submission_file
        where submission_file.submission_id = target_submission_id
          and submission_file.org_id = target_org_id
          and submission_file.field_key = required_block ->> 'fieldKey'
          and submission_file.status = 'available'
      ) then
        raise exception 'Required submission file % is missing.', required_block ->> 'label'
          using errcode = '22023';
      end if;

      continue;
    end if;

    required_value := target_values -> (required_block ->> 'fieldKey');

    if required_block ->> 'type' = 'checkbox_field' then
      if required_value is null
          or jsonb_typeof(required_value) <> 'boolean'
          or required_value <> 'true'::jsonb then
        raise exception 'Required submission field % is incomplete.', required_block ->> 'label'
          using errcode = '22023';
      end if;
    elsif required_value is null
        or jsonb_typeof(required_value) <> 'string'
        or btrim(required_value #>> '{}') = '' then
      raise exception 'Required submission field % is incomplete.', required_block ->> 'label'
        using errcode = '22023';
    end if;
  end loop;

  update public.submissions submission
  set values = target_values,
      status = 'submitted',
      revision = submission.revision + 1,
      updated_by = target_actor_user_id,
      submitted_by = target_actor_user_id,
      updated_at = now(),
      submitted_at = now()
  where submission.id = target_submission_id
    and submission.org_id = target_org_id
  returning submission.* into locked_submission;

  insert into public.audit_logs (
    id,
    org_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    gen_random_uuid(),
    target_org_id,
    target_actor_user_id,
    'submission.submitted',
    'submission',
    target_submission_id,
    jsonb_build_object(
      'templateId', locked_submission.template_id,
      'templateRevision', locked_submission.template_revision,
      'submissionRevision', locked_submission.revision
    )
  );

  return locked_submission;
end;
$$;

revoke all on function public.create_internal_submission_draft(
  uuid,
  uuid,
  uuid,
  text,
  uuid
) from public, anon, authenticated;

revoke all on function public.save_internal_submission_draft(
  uuid,
  uuid,
  integer,
  jsonb,
  uuid
) from public, anon, authenticated;

revoke all on function public.allocate_internal_submission_file(
  uuid,
  uuid,
  integer,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  text,
  uuid
) from public, anon, authenticated;

revoke all on function public.complete_internal_submission_file(
  uuid,
  uuid,
  uuid,
  text,
  text,
  bigint,
  text,
  uuid
) from public, anon, authenticated;

revoke all on function public.submit_internal_submission(
  uuid,
  uuid,
  integer,
  jsonb,
  uuid
) from public, anon, authenticated;

grant execute on function public.create_internal_submission_draft(
  uuid,
  uuid,
  uuid,
  text,
  uuid
) to service_role;

grant execute on function public.save_internal_submission_draft(
  uuid,
  uuid,
  integer,
  jsonb,
  uuid
) to service_role;

grant execute on function public.allocate_internal_submission_file(
  uuid,
  uuid,
  integer,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  text,
  uuid
) to service_role;

grant execute on function public.complete_internal_submission_file(
  uuid,
  uuid,
  uuid,
  text,
  text,
  bigint,
  text,
  uuid
) to service_role;

grant execute on function public.submit_internal_submission(
  uuid,
  uuid,
  integer,
  jsonb,
  uuid
) to service_role;

notify pgrst, 'reload schema';
