-- A draft document's live room closes once the document leaves Active: a
-- member can no longer join it, and no change reaches it, so nothing is
-- written into a draft in the trash or the archive. Guests already lost their
-- way in with 20261002023922; that clause is unchanged here.

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
        = 'contributor'::public.resource_access_level
      and exists (
        select 1
        from public.documents document
        where document.id = room.document_id
          and document.org_id = room.org_id
          and document.lifecycle_state = 'active'
      ) then
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

create or replace function public.append_working_copy_update(
  target_org_id uuid,
  target_room_id uuid,
  expected_revision bigint,
  target_update bytea,
  target_actor_user_id uuid,
  saved_working_copy jsonb default null,
  saved_hash text default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  room public.working_copy_rooms%rowtype;
  saved_count integer;
begin
  update public.working_copy_rooms
  set revision = revision + 1,
    updated_at = now()
  where id = target_room_id
    and org_id = target_org_id
    and revision = expected_revision
  returning * into room;

  if not found then
    return null;
  end if;

  -- A draft in the trash or the archive takes no changes, saved or not.
  if room.document_id is not null and not exists (
    select 1
    from public.documents document
    where document.id = room.document_id
      and document.org_id = target_org_id
      and document.lifecycle_state = 'active'
  ) then
    raise exception 'The working copy can no longer be edited.'
      using errcode = '23514';
  end if;

  insert into public.working_copy_updates (org_id, room_id, revision, update, actor_user_id)
  values (target_org_id, target_room_id, room.revision, target_update, target_actor_user_id);

  if saved_working_copy is not null then
    if room.template_id is not null then
      update public.document_templates
      set title = saved_working_copy->>'title',
        description = saved_working_copy->>'description',
        category = saved_working_copy->>'category',
        content = saved_working_copy->'content',
        revision = revision + 1,
        updated_by = target_actor_user_id
      where id = room.template_id
        and org_id = target_org_id
        and status <> 'archived';
    else
      -- A document that has been sent refuses this in its own trigger.
      update public.documents
      set title = saved_working_copy->>'title',
        template_snapshot = saved_working_copy->'content',
        updated_by = target_actor_user_id
      where id = room.document_id
        and org_id = target_org_id
        and lifecycle_state = 'active';
    end if;

    get diagnostics saved_count = row_count;

    if saved_count <> 1 or saved_hash is null then
      raise exception 'The working copy can no longer be edited.'
        using errcode = '23514';
    end if;

    update public.working_copy_rooms
    set saved_hash = append_working_copy_update.saved_hash
    where id = target_room_id;
  end if;

  return room.revision;
end;
$$;
