alter table public.submission_files
  add column cleanup_after timestamptz not null
    default (now() + interval '20 minutes'),
  add column storage_cleaned_at timestamptz;

alter table public.submission_files
  add constraint submission_files_storage_cleanup_check
    check (
      storage_cleaned_at is null
      or status = 'superseded'
    );

create index submission_files_cleanup_due_idx
  on public.submission_files (cleanup_after, id)
  where status = 'superseded'
    and storage_cleaned_at is null;

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
        or new.available_at is distinct from old.available_at
        or new.superseded_at is distinct from old.superseded_at
        or new.cleanup_after is distinct from old.cleanup_after
        or not superseded_by_cleanup then
      raise exception 'Superseded submission files are immutable.'
        using errcode = '23514';
    end if;

    if old.storage_cleaned_at is null
        and new.storage_cleaned_at is not null then
      if new.updated_at < old.updated_at then
        raise exception 'Submission file cleanup timestamp is invalid.'
          using errcode = '23514';
      end if;

      return new;
    end if;

    if new.storage_cleaned_at is distinct from old.storage_cleaned_at
        or new.updated_at is distinct from old.updated_at then
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
        or new.cleanup_after is distinct from old.cleanup_after
        or new.storage_cleaned_at is distinct from old.storage_cleaned_at
        or not superseded_by_cleanup then
      raise exception 'Available submission files are immutable.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if old.status = 'upload_pending' and new.status = 'upload_pending' then
    if new.checksum_sha256 is distinct from old.checksum_sha256
        or new.available_at is distinct from old.available_at
        or new.superseded_at is distinct from old.superseded_at
        or new.storage_cleaned_at is distinct from old.storage_cleaned_at
        or not superseded_by_cleanup
        or new.cleanup_after < old.cleanup_after then
      raise exception 'Pending submission files are immutable.'
        using errcode = '23514';
    end if;

    if new.cleanup_after = old.cleanup_after
        and new.updated_at is distinct from old.updated_at then
      raise exception 'Pending submission files are immutable.'
        using errcode = '23514';
    end if;

    if new.cleanup_after > old.cleanup_after
        and new.updated_at < old.updated_at then
      raise exception 'Submission file upload window is invalid.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if old.status = 'upload_pending' and new.status = 'available' then
    if new.checksum_sha256 is null
        or new.available_at is null
        or new.superseded_by is not null
        or new.superseded_at is not null
        or new.cleanup_after is distinct from old.cleanup_after
        or new.storage_cleaned_at is not null then
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
        or new.superseded_at is null
        or new.cleanup_after is distinct from old.cleanup_after
        or new.storage_cleaned_at is not null then
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

create or replace function public.record_internal_submission_file_upload_window(
  target_org_id uuid,
  target_submission_id uuid,
  target_file_id uuid,
  target_cleanup_after timestamptz,
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
      or target_cleanup_after is null
      or target_cleanup_after <= now()
      or target_cleanup_after > now() + interval '25 minutes'
      or target_actor_user_id is null then
    raise exception 'Valid submission upload window metadata is required.'
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
    raise exception 'Only the submission creator may renew draft uploads.'
      using errcode = '42501';
  end if;

  if locked_submission.status <> 'draft' then
    raise exception 'Upload windows cannot be renewed after submission.'
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

  if locked_file.status <> 'upload_pending' then
    raise exception 'Only pending submission uploads may be renewed.'
      using errcode = 'P0001';
  end if;

  if target_cleanup_after > locked_file.cleanup_after then
    update public.submission_files submission_file
    set cleanup_after = target_cleanup_after,
        updated_at = now()
    where submission_file.id = target_file_id
      and submission_file.submission_id = target_submission_id
      and submission_file.org_id = target_org_id
    returning submission_file.* into locked_file;
  end if;

  return locked_file;
end;
$$;

create or replace function public.mark_internal_submission_file_storage_cleaned(
  target_file_id uuid,
  target_storage_key text
)
returns public.submission_files
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_file public.submission_files%rowtype;
begin
  if target_file_id is null
      or target_storage_key is null
      or target_storage_key = '' then
    raise exception 'Valid submission cleanup identifiers are required.'
      using errcode = '22023';
  end if;

  select submission_file.*
  into locked_file
  from public.submission_files submission_file
  where submission_file.id = target_file_id
  for update;

  if not found then
    raise exception 'Submission file cleanup record was not found.'
      using errcode = 'P0002';
  end if;

  if locked_file.storage_key <> target_storage_key then
    raise exception 'Submission file cleanup key is invalid.'
      using errcode = '22023';
  end if;

  if locked_file.status <> 'superseded' then
    raise exception 'Only superseded submission files may be cleaned.'
      using errcode = 'P0001';
  end if;

  if locked_file.storage_cleaned_at is not null then
    return locked_file;
  end if;

  if locked_file.cleanup_after > now() then
    raise exception 'Submission file cleanup window has not elapsed.'
      using errcode = 'P0001';
  end if;

  update public.submission_files submission_file
  set storage_cleaned_at = now(),
      updated_at = now()
  where submission_file.id = target_file_id
  returning submission_file.* into locked_file;

  return locked_file;
end;
$$;

revoke all on function public.record_internal_submission_file_upload_window(
  uuid,
  uuid,
  uuid,
  timestamptz,
  uuid
) from public, anon, authenticated;

revoke all on function public.mark_internal_submission_file_storage_cleaned(
  uuid,
  text
) from public, anon, authenticated;

grant execute on function public.record_internal_submission_file_upload_window(
  uuid,
  uuid,
  uuid,
  timestamptz,
  uuid
) to service_role;

grant execute on function public.mark_internal_submission_file_storage_cleaned(
  uuid,
  text
) to service_role;

comment on column public.submission_files.cleanup_after is
  'Earliest safe deletion time after every issued create-only upload URL has expired.';

comment on column public.submission_files.storage_cleaned_at is
  'Timestamp recorded after the superseded private R2 object has been deleted.';

notify pgrst, 'reload schema';
