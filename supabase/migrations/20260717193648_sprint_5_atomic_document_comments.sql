create or replace function public.create_document_comment(
  target_org_id uuid,
  target_document_id uuid,
  target_comment_id uuid,
  target_body text,
  target_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  document_archived_at timestamptz;
  created_comment_id uuid;
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
    raise exception 'Archived documents cannot be commented on.'
      using errcode = 'P0001';
  end if;

  insert into public.document_comments (
    id,
    org_id,
    document_id,
    created_by,
    body
  )
  values (
    target_comment_id,
    target_org_id,
    target_document_id,
    target_actor_user_id,
    target_body
  )
  returning id into created_comment_id;

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
    'document.commented',
    jsonb_build_object('commentId', created_comment_id)
  );

  return created_comment_id;
end;
$$;

revoke execute on function public.create_document_comment(
  uuid,
  uuid,
  uuid,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.create_document_comment(
  uuid,
  uuid,
  uuid,
  text,
  uuid
) to service_role;

notify pgrst, 'reload schema';
