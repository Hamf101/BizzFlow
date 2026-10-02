-- People edit a working copy together.
--
-- A template's working copy, or a draft document's pages, can be open in
-- several editors at once. Each editor sends its changes to the app as Yjs
-- updates. The app checks the person may still edit, applies the update to
-- the room's state, and validates what the working copy becomes; only then is
-- the update kept here, in order, and passed on to everyone else in the room.
-- When the working copy is complete enough to save, the same transaction
-- writes it to the template or document, so a room and what it edits never
-- disagree about which change came last.
--
-- Signed-in users hold no privilege on these tables. They join a room's
-- private Realtime channel, which the policies at the end allow only to those
-- who may edit what the room holds; the channel carries presence from them
-- and changes from the app, never changes from them.
create table public.working_copy_rooms (
  id uuid primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  template_id uuid,
  document_id uuid,
  -- The last update kept, counting from one; zero before any.
  revision bigint not null default 0 check (revision >= 0),
  -- The first state and every update up to state_revision, merged.
  state bytea not null check (octet_length(state) between 1 and 16777216),
  state_revision bigint not null default 0,
  -- How the shared document is laid out, should that ever change.
  schema_version smallint not null default 1 check (schema_version > 0),
  -- A hash of the working copy the room last wrote to its template or
  -- document, or started from; anything else there was changed outside it.
  saved_hash text not null check (saved_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (template_id),
  unique (document_id),
  check (num_nonnulls(template_id, document_id) = 1),
  check (state_revision between 0 and revision),
  foreign key (template_id, org_id)
    references public.document_templates (id, org_id) on delete cascade,
  foreign key (document_id, org_id)
    references public.documents (id, org_id) on delete cascade
);

create index working_copy_rooms_org_idx on public.working_copy_rooms (org_id);

create table public.working_copy_updates (
  org_id uuid not null,
  room_id uuid not null,
  revision bigint not null check (revision > 0),
  update bytea not null check (octet_length(update) between 1 and 1048576),
  actor_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (room_id, revision),
  foreign key (room_id, org_id)
    references public.working_copy_rooms (id, org_id) on delete cascade
);

create index working_copy_updates_org_idx on public.working_copy_updates (org_id);
create index working_copy_updates_actor_idx on public.working_copy_updates (actor_user_id)
  where actor_user_id is not null;

alter table public.working_copy_rooms enable row level security;
alter table public.working_copy_rooms force row level security;
alter table public.working_copy_updates enable row level security;
alter table public.working_copy_updates force row level security;

revoke all on table public.working_copy_rooms from anon, authenticated, service_role;
revoke all on table public.working_copy_updates from anon, authenticated, service_role;
-- An update is never changed: it is kept, then merged into the state and let go.
grant select, insert, update on table public.working_copy_rooms to service_role;
grant select, insert, delete on table public.working_copy_updates to service_role;

-- Keeps one validated update as the next revision, and with it the working
-- copy it makes, when that can be saved. Returns null when the room has moved
-- past expected_revision, so the app can apply the newer updates and retry.
create function public.append_working_copy_update(
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
        and org_id = target_org_id;
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

-- Merges the updates up to a revision into the room's state and lets them go:
-- someone that far behind is sent the state instead.
create function public.compact_working_copy_room(
  target_org_id uuid,
  target_room_id uuid,
  target_state bytea,
  target_state_revision bigint
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.working_copy_rooms
  set state = target_state,
    state_revision = target_state_revision
  where id = target_room_id
    and org_id = target_org_id
    and state_revision < target_state_revision
    and revision >= target_state_revision;

  if not found then
    return false;
  end if;

  delete from public.working_copy_updates
  where room_id = target_room_id
    and org_id = target_org_id
    and revision <= target_state_revision;

  return true;
end;
$$;

revoke all on function public.append_working_copy_update(uuid, uuid, bigint, bytea, uuid, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.compact_working_copy_room(uuid, uuid, bytea, bigint)
  from public, anon, authenticated;
grant execute on function public.append_working_copy_update(uuid, uuid, bigint, bytea, uuid, jsonb, text)
  to service_role;
grant execute on function public.compact_working_copy_room(uuid, uuid, bytea, bigint)
  to service_role;

-- Whether an active member's role allows an action, as the app decides it:
-- the owner may do everything, anyone else what their role lists.
create function private.member_can(
  target_org_id uuid,
  target_user_id uuid,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    left join public.organization_roles role
      on role.org_id = membership.org_id
      and role.id = membership.role_definition_id
    where membership.org_id = target_org_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
      and (membership.role = 'owner_admin' or target_action = any (role.permissions))
  );
$$;

-- Whether the signed-in person may join a room's channel: someone who may
-- edit templates for a template's room, and for a document's room someone
-- who may fill documents and is a contributor to that one.
create function private.can_join_working_copy(target_topic text)
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
    return private.member_can(room.org_id, actor_user_id, 'templates:manage');
  end if;

  return private.member_can(room.org_id, actor_user_id, 'documents:fill')
    and private.effective_document_access_level(room.org_id, room.document_id, actor_user_id)
      = 'contributor'::public.resource_access_level;
end;
$$;

revoke all on function private.member_can(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.can_join_working_copy(text)
  from public, anon, authenticated, service_role;
grant execute on function private.can_join_working_copy(text) to authenticated;

create policy "Editors of a working copy hear its room"
  on realtime.messages
  for select
  to authenticated
  using ((select private.can_join_working_copy((select realtime.topic()))));

create policy "Editors of a working copy say where they are"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and (select private.can_join_working_copy((select realtime.topic())))
  );
