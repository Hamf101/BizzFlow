create or replace function public.complete_document_version(
  target_org_id uuid,
  target_document_id uuid,
  target_version_id uuid,
  target_actor_user_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  document_archived_at timestamptz;
  existing_current_version_id uuid;
  current_version_number integer;
  completed_version_number integer;
  completed_version_status text;
  completed_original_filename text;
begin
  select document.archived_at, document.current_version_id
  into document_archived_at, existing_current_version_id
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Document not found.'
      using errcode = 'P0002';
  end if;

  if document_archived_at is not null then
    raise exception 'Archived document uploads cannot be completed.'
      using errcode = 'P0001';
  end if;

  select version.version_number, version.status, version.original_filename
  into
    completed_version_number,
    completed_version_status,
    completed_original_filename
  from public.document_versions version
  where version.id = target_version_id
    and version.document_id = target_document_id
    and version.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Document version not found.'
      using errcode = 'P0002';
  end if;

  -- A concurrent completion may have committed while this call waited on locks.
  if completed_version_status = 'available' then
    return true;
  end if;

  if completed_version_status <> 'upload_pending' then
    raise exception 'Document version is not pending upload.'
      using errcode = 'P0001';
  end if;

  if existing_current_version_id is not null then
    select version.version_number
    into current_version_number
    from public.document_versions version
    where version.id = existing_current_version_id
      and version.document_id = target_document_id
      and version.org_id = target_org_id;
  end if;

  update public.document_versions
  set status = 'available'
  where id = target_version_id
    and document_id = target_document_id
    and org_id = target_org_id;

  update public.documents document
  set current_version_id = case
        when completed_version_number > coalesce(current_version_number, 0)
          then target_version_id
        else document.current_version_id
      end,
      updated_by = target_actor_user_id
  where document.id = target_document_id
    and document.org_id = target_org_id;

  insert into public.document_activity_events (
    id,
    org_id,
    document_id,
    actor_user_id,
    event_type,
    metadata
  )
  values (
    gen_random_uuid(),
    target_org_id,
    target_document_id,
    target_actor_user_id,
    case
      when completed_version_number = 1 then 'document.uploaded'
      else 'document.replaced'
    end,
    jsonb_build_object(
      'versionId', target_version_id,
      'versionNumber', completed_version_number,
      'originalFilename', completed_original_filename
    )
  );

  return true;
end;
$$;

create or replace function public.archive_document(
  target_org_id uuid,
  target_document_id uuid,
  target_actor_user_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  document_archived_at timestamptz;
begin
  select document.archived_at
  into document_archived_at
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Document not found.'
      using errcode = 'P0002';
  end if;

  if document_archived_at is not null then
    return false;
  end if;

  update public.documents document
  set archived_at = now(),
      archived_by = target_actor_user_id,
      updated_by = target_actor_user_id
  where document.id = target_document_id
    and document.org_id = target_org_id;

  insert into public.document_activity_events (
    id,
    org_id,
    document_id,
    actor_user_id,
    event_type,
    metadata
  )
  values (
    gen_random_uuid(),
    target_org_id,
    target_document_id,
    target_actor_user_id,
    'document.archived',
    '{}'::jsonb
  );

  return true;
end;
$$;

comment on column public.document_versions.checksum_sha256 is
  'Reserved for future end-to-end checksum enforcement; current uploads leave this null.';

revoke execute on function public.complete_document_version(
  uuid,
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;

revoke execute on function public.archive_document(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function public.complete_document_version(
  uuid,
  uuid,
  uuid,
  uuid
) to service_role;

grant execute on function public.archive_document(
  uuid,
  uuid,
  uuid
) to service_role;

notify pgrst, 'reload schema';
