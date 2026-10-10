-- Someone outside the workspace given a document as an Editor works in its
-- live room beside the members: Realtime lets them join its private channel.
-- Their grant is the only way in, and it lapses with the grant or once the
-- document leaves Active. Writes still go through the service layer, which
-- checks the same grant.

create or replace function private.can_join_working_copy(target_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  room public.working_copy_rooms%rowtype;
begin
  if actor_user_id is null
      or target_topic is null
      or target_topic !~ '^working-copy:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  select *
  into room
  from public.working_copy_rooms
  where id = substr(target_topic, char_length('working-copy:') + 1)::uuid;

  if not found then
    return false;
  end if;

  if room.template_id is not null then
    -- Someone in no workspace at all has no level: a plain no, not an unknown.
    return coalesce(
      private.effective_template_access_level(room.org_id, room.template_id, actor_user_id)
        = 'editor'::public.template_access_level,
      false
    );
  end if;

  if private.member_can(room.org_id, actor_user_id, 'documents:fill')
      and private.effective_document_access_level(room.org_id, room.document_id, actor_user_id)
        = 'contributor'::public.resource_access_level then
    return true;
  end if;

  return exists (
    select 1
    from public.document_guest_grants grant_row
    join public.documents document
      on document.id = grant_row.document_id
     and document.org_id = grant_row.org_id
    where grant_row.org_id = room.org_id
      and grant_row.document_id = room.document_id
      and grant_row.user_id = actor_user_id
      and grant_row.access_level = 'contributor'::public.resource_access_level
      and document.lifecycle_state = 'active'
  );
end;
$$;
