alter table public.submission_files
  add column expected_checksum_sha256 text,
  add column superseded_by uuid references public.profiles (id) on delete set null,
  add column superseded_at timestamptz;

alter table public.submission_files
  drop constraint submission_files_status_check,
  drop constraint submission_files_state_check,
  drop constraint submission_files_submission_id_field_key_key;

alter table public.submission_files
  add constraint submission_files_expected_checksum_sha256_check
    check (
      expected_checksum_sha256 is null
      or expected_checksum_sha256 ~ '^[0-9a-f]{64}$'
    ),
  add constraint submission_files_status_check
    check (status in ('upload_pending', 'available', 'superseded')),
  add constraint submission_files_state_check
    check (
      (
        status = 'upload_pending'
        and checksum_sha256 is null
        and available_at is null
        and superseded_by is null
        and superseded_at is null
      )
      or
      (
        status = 'available'
        and available_at is not null
        and superseded_by is null
        and superseded_at is null
      )
      or
      (
        status = 'superseded'
        and superseded_at is not null
      )
    );

create unique index submission_files_active_field_idx
  on public.submission_files (submission_id, field_key)
  where status in ('upload_pending', 'available');

create index submission_files_superseded_by_idx
  on public.submission_files (superseded_by)
  where superseded_by is not null;

create or replace function public.enforce_submission_file_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uploaded_by_cleanup boolean;
  superseded_by_cleanup boolean;
begin
  uploaded_by_cleanup :=
    new.uploaded_by is not distinct from old.uploaded_by
    or (old.uploaded_by is not null and new.uploaded_by is null);
  superseded_by_cleanup :=
    new.superseded_by is not distinct from old.superseded_by
    or (old.superseded_by is not null and new.superseded_by is null);

  if new.id is distinct from old.id
      or new.org_id is distinct from old.org_id
      or new.submission_id is distinct from old.submission_id
      or new.field_key is distinct from old.field_key
      or new.storage_key is distinct from old.storage_key
      or new.original_filename is distinct from old.original_filename
      or new.safe_filename is distinct from old.safe_filename
      or new.content_type is distinct from old.content_type
      or new.byte_size is distinct from old.byte_size
      or new.expected_checksum_sha256 is distinct from old.expected_checksum_sha256
      or new.created_at is distinct from old.created_at
      or not uploaded_by_cleanup then
    raise exception 'Submission file identity is immutable.'
      using errcode = '23514';
  end if;

  if old.status = 'superseded' then
    if new.status is distinct from old.status
        or new.checksum_sha256 is distinct from old.checksum_sha256
        or new.updated_at is distinct from old.updated_at
        or new.available_at is distinct from old.available_at
        or new.superseded_at is distinct from old.superseded_at
        or not superseded_by_cleanup then
      raise exception 'Superseded submission files are immutable.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if old.status = 'available' and new.status = 'available' then
    if new.checksum_sha256 is distinct from old.checksum_sha256
        or new.updated_at is distinct from old.updated_at
        or new.available_at is distinct from old.available_at
        or new.superseded_at is distinct from old.superseded_at
        or not superseded_by_cleanup then
      raise exception 'Available submission files are immutable.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if old.status = 'upload_pending' and new.status = 'upload_pending' then
    if new.checksum_sha256 is distinct from old.checksum_sha256
        or new.updated_at is distinct from old.updated_at
        or new.available_at is distinct from old.available_at
        or new.superseded_at is distinct from old.superseded_at
        or not superseded_by_cleanup then
      raise exception 'Pending submission files are immutable.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if old.status = 'upload_pending' and new.status = 'available' then
    if new.checksum_sha256 is null
        or new.available_at is null
        or new.superseded_by is not null
        or new.superseded_at is not null then
      raise exception 'Verified file metadata is required for availability.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.status = 'superseded'
      and old.status in ('upload_pending', 'available') then
    if new.checksum_sha256 is distinct from old.checksum_sha256
        or new.available_at is distinct from old.available_at
        or new.superseded_by is null
        or new.superseded_at is null then
      raise exception 'Valid superseded file metadata is required.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  raise exception 'Submission file state transition is invalid.'
    using errcode = '23514';
end;
$$;

revoke all on function public.enforce_submission_file_update()
  from public, anon, authenticated, service_role;

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
) from public, anon, authenticated, service_role;

drop function public.allocate_internal_submission_file(
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
);

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
  target_expected_checksum_sha256 text,
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
      or target_storage_key is null
      or target_expected_checksum_sha256 is null
      or target_expected_checksum_sha256 !~ '^[0-9a-f]{64}$'
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
      or target_byte_size not between 1 and 20971520
      or not (case target_content_type
        when 'application/pdf' then lower(target_safe_filename) ~ '\.pdf$'
        when 'image/jpeg' then lower(target_safe_filename) ~ '\.(jpg|jpeg)$'
        when 'image/png' then lower(target_safe_filename) ~ '\.png$'
        when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          then lower(target_safe_filename) ~ '\.docx$'
        when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          then lower(target_safe_filename) ~ '\.xlsx$'
        when 'text/csv' then lower(target_safe_filename) ~ '\.csv$'
        else false
      end) then
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
    and submission_file.status in ('upload_pending', 'available')
  for update;

  if found then
    if prepared_file.id = target_file_id
        and prepared_file.status = 'upload_pending'
        and prepared_file.storage_key = target_storage_key
        and prepared_file.original_filename = target_original_filename
        and prepared_file.safe_filename = target_safe_filename
        and prepared_file.content_type = target_content_type
        and prepared_file.byte_size = target_byte_size
        and prepared_file.expected_checksum_sha256 = target_expected_checksum_sha256
        and prepared_file.uploaded_by = target_actor_user_id then
      return prepared_file;
    end if;

    raise exception 'This submission field already has an active file allocation.'
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
    expected_checksum_sha256,
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
    target_expected_checksum_sha256,
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
begin
  if target_org_id is null
      or target_submission_id is null
      or target_file_id is null
      or target_storage_key is null
      or target_content_type is null
      or target_byte_size is null
      or target_checksum_sha256 is null
      or target_checksum_sha256 !~ '^[0-9a-f]{64}$'
      or target_actor_user_id is null then
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

  if locked_file.storage_key <> target_storage_key
      or locked_file.content_type <> target_content_type
      or locked_file.byte_size <> target_byte_size then
    raise exception 'Uploaded object metadata does not match its allocation.'
      using errcode = '22023';
  end if;

  if locked_file.status = 'available' then
    if locked_file.checksum_sha256 = target_checksum_sha256 then
      return locked_file;
    end if;

    raise exception 'Completed submission file metadata cannot change.'
      using errcode = 'P0001';
  end if;

  if locked_file.status <> 'upload_pending' then
    raise exception 'Superseded submission files cannot be completed.'
      using errcode = 'P0001';
  end if;

  if locked_file.expected_checksum_sha256 is null
      or locked_file.expected_checksum_sha256 <> target_checksum_sha256 then
    raise exception 'Uploaded object checksum does not match its allocation.'
      using errcode = '22023';
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

create or replace function public.supersede_internal_submission_file(
  target_org_id uuid,
  target_submission_id uuid,
  target_file_id uuid,
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
begin
  if target_org_id is null
      or target_submission_id is null
      or target_file_id is null
      or target_actor_user_id is null then
    raise exception 'Valid submission file identifiers are required.'
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
    raise exception 'Only the submission creator may replace draft files.'
      using errcode = '42501';
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

  if locked_file.status = 'superseded' then
    return locked_file;
  end if;

  if locked_submission.status <> 'draft' then
    raise exception 'Files cannot be replaced after submission.'
      using errcode = 'P0001';
  end if;

  update public.submission_files submission_file
  set status = 'superseded',
      superseded_by = target_actor_user_id,
      superseded_at = now(),
      updated_at = now()
  where submission_file.id = target_file_id
    and submission_file.submission_id = target_submission_id
    and submission_file.org_id = target_org_id
  returning submission_file.* into locked_file;

  return locked_file;
end;
$$;

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

revoke all on function public.supersede_internal_submission_file(
  uuid,
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;

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

grant execute on function public.supersede_internal_submission_file(
  uuid,
  uuid,
  uuid,
  uuid
) to service_role;

notify pgrst, 'reload schema';
