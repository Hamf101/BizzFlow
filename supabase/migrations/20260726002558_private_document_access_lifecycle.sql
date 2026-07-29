-- Private document access and reversible document/folder lifecycle foundation.
--
-- Access grants are additive. Organization owners and resource creators receive
-- implicit contributor access; every other actor needs a matching direct or
-- inherited grant. External reviewers are always capped at viewer access.

do $$
begin
  create type public.resource_access_level as enum ('viewer', 'contributor');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.resource_lifecycle_state as enum (
    'active',
    'archived',
    'trashed',
    'purge_pending'
  );
exception
  when duplicate_object then null;
end $$;

revoke all on type public.resource_access_level from public, anon;
revoke all on type public.resource_lifecycle_state from public, anon;
grant usage on type public.resource_access_level to authenticated, service_role;
grant usage on type public.resource_lifecycle_state to authenticated, service_role;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create table private.resource_trash_operations (
  org_id uuid not null
    references public.organizations (id) on delete cascade,
  operation_id uuid not null,
  root_resource_kind text not null
    check (root_resource_kind in ('document', 'folder')),
  root_resource_id uuid not null,
  actor_user_id uuid
    references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, operation_id)
);

create index resource_trash_operations_actor_fk_idx
  on private.resource_trash_operations (actor_user_id)
  where actor_user_id is not null;

revoke all on table private.resource_trash_operations
  from public, anon, authenticated, service_role;
grant select, insert on table private.resource_trash_operations
  to service_role;

create table public.folder_access_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  folder_id uuid not null,
  user_id uuid,
  organization_role public.organization_role,
  access_level public.resource_access_level not null,
  granted_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  constraint folder_access_grants_folder_org_fkey
    foreign key (folder_id, org_id)
    references public.folders (id, org_id)
    on delete cascade,
  constraint folder_access_grants_user_membership_fkey
    foreign key (org_id, user_id)
    references public.organization_memberships (org_id, user_id)
    on delete cascade,
  constraint folder_access_grants_granted_by_membership_fkey
    foreign key (org_id, granted_by)
    references public.organization_memberships (org_id, user_id)
    on delete set null (granted_by),
  constraint folder_access_grants_exactly_one_principal
    check (num_nonnulls(user_id, organization_role) = 1),
  constraint folder_access_grants_external_reviewer_viewer_only
    check (
      organization_role is distinct from 'external_reviewer'
      or access_level = 'viewer'
    )
);

create table public.document_access_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  document_id uuid not null,
  user_id uuid,
  organization_role public.organization_role,
  access_level public.resource_access_level not null,
  granted_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  constraint document_access_grants_document_org_fkey
    foreign key (document_id, org_id)
    references public.documents (id, org_id)
    on delete cascade,
  constraint document_access_grants_user_membership_fkey
    foreign key (org_id, user_id)
    references public.organization_memberships (org_id, user_id)
    on delete cascade,
  constraint document_access_grants_granted_by_membership_fkey
    foreign key (org_id, granted_by)
    references public.organization_memberships (org_id, user_id)
    on delete set null (granted_by),
  constraint document_access_grants_exactly_one_principal
    check (num_nonnulls(user_id, organization_role) = 1),
  constraint document_access_grants_external_reviewer_viewer_only
    check (
      organization_role is distinct from 'external_reviewer'
      or access_level = 'viewer'
    )
);

create unique index folder_access_grants_user_unique_idx
  on public.folder_access_grants (org_id, folder_id, user_id)
  where user_id is not null;

create unique index folder_access_grants_role_unique_idx
  on public.folder_access_grants (org_id, folder_id, organization_role)
  where organization_role is not null;

create index folder_access_grants_org_resource_idx
  on public.folder_access_grants (org_id, folder_id);

create index folder_access_grants_user_fk_idx
  on public.folder_access_grants (org_id, user_id)
  where user_id is not null;

create index folder_access_grants_granted_by_fk_idx
  on public.folder_access_grants (org_id, granted_by)
  where granted_by is not null;

create unique index document_access_grants_user_unique_idx
  on public.document_access_grants (org_id, document_id, user_id)
  where user_id is not null;

create unique index document_access_grants_role_unique_idx
  on public.document_access_grants (org_id, document_id, organization_role)
  where organization_role is not null;

create index document_access_grants_org_resource_idx
  on public.document_access_grants (org_id, document_id);

create index document_access_grants_user_fk_idx
  on public.document_access_grants (org_id, user_id)
  where user_id is not null;

create index document_access_grants_granted_by_fk_idx
  on public.document_access_grants (org_id, granted_by)
  where granted_by is not null;

create trigger folder_access_grants_set_updated_at
  before update on public.folder_access_grants
  for each row execute function public.set_updated_at();

create trigger document_access_grants_set_updated_at
  before update on public.document_access_grants
  for each row execute function public.set_updated_at();

alter table public.folder_access_grants enable row level security;
alter table public.folder_access_grants force row level security;
alter table public.document_access_grants enable row level security;
alter table public.document_access_grants force row level security;

revoke all on table public.folder_access_grants
  from public, anon, authenticated, service_role;
revoke all on table public.document_access_grants
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.folder_access_grants
  to service_role;
grant select, insert, update, delete on table public.document_access_grants
  to service_role;

alter table public.folders
  add column if not exists lifecycle_state public.resource_lifecycle_state,
  add column if not exists trashed_by uuid
    references public.profiles (id) on delete set null,
  add column if not exists trashed_at timestamptz,
  add column if not exists purge_after timestamptz,
  add column if not exists pre_trash_lifecycle_state
    public.resource_lifecycle_state,
  add column if not exists trash_operation_id uuid;

alter table public.documents
  add column if not exists lifecycle_state public.resource_lifecycle_state,
  add column if not exists trashed_by uuid
    references public.profiles (id) on delete set null,
  add column if not exists trashed_at timestamptz,
  add column if not exists purge_after timestamptz,
  add column if not exists pre_trash_lifecycle_state
    public.resource_lifecycle_state,
  add column if not exists trash_operation_id uuid;

-- Legacy archive metadata is authoritative during this additive backfill.
update public.folders folder
set lifecycle_state = case
      when folder.archived_at is null then 'active'
      else 'archived'
    end::public.resource_lifecycle_state,
    archived_by = case
      when folder.archived_at is null then null
      else folder.archived_by
    end,
    trashed_by = null,
    trashed_at = null,
    purge_after = null,
    pre_trash_lifecycle_state = null,
    trash_operation_id = null
where folder.lifecycle_state is null;

update public.documents document
set lifecycle_state = case
      when document.archived_at is null then 'active'
      else 'archived'
    end::public.resource_lifecycle_state,
    archived_by = case
      when document.archived_at is null then null
      else document.archived_by
    end,
    trashed_by = null,
    trashed_at = null,
    purge_after = null,
    pre_trash_lifecycle_state = null,
    trash_operation_id = null
where document.lifecycle_state is null;

alter table public.folders
  alter column lifecycle_state set default 'active',
  alter column lifecycle_state set not null;

alter table public.documents
  alter column lifecycle_state set default 'active',
  alter column lifecycle_state set not null;

alter table public.folders
  drop constraint if exists folders_lifecycle_shape;

alter table public.folders
  add constraint folders_lifecycle_shape
  check (
    (
      lifecycle_state = 'active'
      and archived_at is null
      and trashed_at is null
      and purge_after is null
      and pre_trash_lifecycle_state is null
      and trash_operation_id is null
    )
    or (
      lifecycle_state = 'archived'
      and archived_at is not null
      and trashed_at is null
      and purge_after is null
      and pre_trash_lifecycle_state is null
      and trash_operation_id is null
    )
    or (
      lifecycle_state in ('trashed', 'purge_pending')
      and archived_at is not null
      and trashed_at is not null
      and pre_trash_lifecycle_state in ('active', 'archived')
      and trash_operation_id is not null
    )
  );

alter table public.documents
  drop constraint if exists documents_lifecycle_shape;

alter table public.documents
  add constraint documents_lifecycle_shape
  check (
    (
      lifecycle_state = 'active'
      and archived_at is null
      and trashed_at is null
      and purge_after is null
      and pre_trash_lifecycle_state is null
      and trash_operation_id is null
    )
    or (
      lifecycle_state = 'archived'
      and archived_at is not null
      and trashed_at is null
      and purge_after is null
      and pre_trash_lifecycle_state is null
      and trash_operation_id is null
    )
    or (
      lifecycle_state in ('trashed', 'purge_pending')
      and archived_at is not null
      and trashed_at is not null
      and pre_trash_lifecycle_state in ('active', 'archived')
      and trash_operation_id is not null
    )
  );

create index folders_org_lifecycle_parent_idx
  on public.folders (org_id, lifecycle_state, parent_folder_id, created_at desc);

create index folders_org_purge_after_idx
  on public.folders (org_id, purge_after)
  where lifecycle_state = 'trashed' and purge_after is not null;

create index documents_org_lifecycle_folder_idx
  on public.documents (org_id, lifecycle_state, folder_id, created_at desc);

create index documents_org_purge_after_idx
  on public.documents (org_id, purge_after)
  where lifecycle_state = 'trashed' and purge_after is not null;

comment on column public.folders.lifecycle_state is
  'Explicit lifecycle state. archived_at remains populated for every non-active state for rollout compatibility.';
comment on column public.documents.lifecycle_state is
  'Explicit lifecycle state. archived_at remains populated for every non-active state for rollout compatibility.';
comment on column public.folders.trash_operation_id is
  'Groups one recursive folder trash operation so restore does not revive descendants trashed earlier.';
comment on column public.documents.trash_operation_id is
  'Groups direct or recursive trash operations and scopes reversible restore.';

do $$
declare
  cyclic_folder_count bigint;
  ownerless_resource_org_count bigint;
  inactive_creator_count bigint;
begin
  with recursive lineage as (
    select
      folder.org_id,
      folder.id as origin_id,
      folder.id,
      folder.parent_folder_id,
      array[folder.id]::uuid[] as visited_ids,
      false as cycle_found
    from public.folders folder

    union all

    select
      lineage.org_id,
      lineage.origin_id,
      parent.id,
      parent.parent_folder_id,
      lineage.visited_ids || parent.id,
      parent.id = any(lineage.visited_ids)
    from lineage
    join public.folders parent
      on parent.id = lineage.parent_folder_id
     and parent.org_id = lineage.org_id
    where not lineage.cycle_found
  )
  select count(distinct lineage.origin_id)
  into cyclic_folder_count
  from lineage
  where lineage.cycle_found;

  if cyclic_folder_count > 0 then
    raise exception
      'Private access migration blocked: % folders belong to a cyclic hierarchy.',
      cyclic_folder_count
      using errcode = '23514';
  end if;

  select count(*)
  into ownerless_resource_org_count
  from public.organizations organization
  where (
      exists (
        select 1
        from public.folders folder
        where folder.org_id = organization.id
      )
      or exists (
        select 1
        from public.documents document
        where document.org_id = organization.id
      )
    )
    and not exists (
      select 1
      from public.organization_memberships membership
      where membership.org_id = organization.id
        and membership.status = 'active'
        and membership.role = 'owner_admin'
    );

  if ownerless_resource_org_count > 0 then
    raise exception
      'Private access migration blocked: % organizations with resources have no active owner.',
      ownerless_resource_org_count
      using errcode = '23514';
  end if;

  select count(*)
  into inactive_creator_count
  from (
    select folder.org_id, folder.created_by
    from public.folders folder
    where folder.created_by is not null

    union all

    select document.org_id, document.created_by
    from public.documents document
    where document.created_by is not null
  ) resource
  where not exists (
    select 1
    from public.organization_memberships membership
    where membership.org_id = resource.org_id
      and membership.user_id = resource.created_by
      and membership.status = 'active'
  );

  if inactive_creator_count > 0 then
    raise notice
      'Private access migration: % resources have a null, disabled, or non-member creator; active owners retain contributor access.',
      inactive_creator_count;
  end if;
end $$;

create or replace function private.effective_folder_access_level(
  target_org_id uuid,
  target_folder_id uuid,
  target_actor_user_id uuid
)
returns public.resource_access_level
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role public.organization_role;
  access_rank integer;
begin
  select membership.role
  into actor_role
  from public.organization_memberships membership
  where membership.org_id = target_org_id
    and membership.user_id = target_actor_user_id
    and membership.status = 'active';

  if not found then
    return null;
  end if;

  if not exists (
    select 1
    from public.folders folder
    where folder.id = target_folder_id
      and folder.org_id = target_org_id
  ) then
    return null;
  end if;

  if actor_role = 'owner_admin' then
    return 'contributor';
  end if;

  with recursive folder_lineage as (
    select
      folder.id,
      folder.parent_folder_id,
      folder.created_by,
      array[folder.id]::uuid[] as visited_ids
    from public.folders folder
    where folder.id = target_folder_id
      and folder.org_id = target_org_id

    union all

    select
      parent.id,
      parent.parent_folder_id,
      parent.created_by,
      lineage.visited_ids || parent.id
    from folder_lineage lineage
    join public.folders parent
      on parent.id = lineage.parent_folder_id
     and parent.org_id = target_org_id
    where not parent.id = any(lineage.visited_ids)
  ),
  access_scores as (
    select 2 as access_rank
    from folder_lineage lineage
    where lineage.created_by = target_actor_user_id

    union all

    select
      case grant_row.access_level
        when 'contributor' then 2
        else 1
      end
    from public.folder_access_grants grant_row
    join folder_lineage lineage
      on lineage.id = grant_row.folder_id
    where grant_row.org_id = target_org_id
      and (
        grant_row.user_id = target_actor_user_id
        or grant_row.organization_role = actor_role
      )
  )
  select max(score.access_rank)
  into access_rank
  from access_scores score;

  if access_rank is null then
    return null;
  end if;

  if actor_role = 'external_reviewer' or access_rank = 1 then
    return 'viewer';
  end if;

  return 'contributor';
end;
$$;

create or replace function private.effective_document_access_level(
  target_org_id uuid,
  target_document_id uuid,
  target_actor_user_id uuid
)
returns public.resource_access_level
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role public.organization_role;
  document_creator_id uuid;
  document_folder_id uuid;
  inherited_access public.resource_access_level;
  access_rank integer;
begin
  select membership.role
  into actor_role
  from public.organization_memberships membership
  where membership.org_id = target_org_id
    and membership.user_id = target_actor_user_id
    and membership.status = 'active';

  if not found then
    return null;
  end if;

  select document.created_by, document.folder_id
  into document_creator_id, document_folder_id
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id;

  if not found then
    return null;
  end if;

  if actor_role = 'owner_admin' then
    return 'contributor';
  end if;

  if document_folder_id is not null then
    inherited_access := private.effective_folder_access_level(
      target_org_id,
      document_folder_id,
      target_actor_user_id
    );
  end if;

  select max(score.access_rank)
  into access_rank
  from (
    select 2 as access_rank
    where document_creator_id = target_actor_user_id

    union all

    select
      case grant_row.access_level
        when 'contributor' then 2
        else 1
      end
    from public.document_access_grants grant_row
    where grant_row.org_id = target_org_id
      and grant_row.document_id = target_document_id
      and (
        grant_row.user_id = target_actor_user_id
        or grant_row.organization_role = actor_role
      )

    union all

    select case inherited_access
      when 'contributor' then 2
      when 'viewer' then 1
      else null
    end
  ) score
  where score.access_rank is not null;

  if access_rank is null then
    return null;
  end if;

  if actor_role = 'external_reviewer' or access_rank = 1 then
    return 'viewer';
  end if;

  return 'contributor';
end;
$$;

create or replace function private.authenticated_can_access_folder(
  target_org_id uuid,
  target_folder_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.effective_folder_access_level(
    target_org_id,
    target_folder_id,
    (select auth.uid())
  ) is not null;
$$;

create or replace function private.authenticated_can_access_document(
  target_org_id uuid,
  target_document_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.effective_document_access_level(
    target_org_id,
    target_document_id,
    (select auth.uid())
  ) is not null;
$$;

revoke all on function private.effective_folder_access_level(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.effective_document_access_level(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.authenticated_can_access_folder(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.authenticated_can_access_document(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function private.effective_folder_access_level(uuid, uuid, uuid)
  to service_role;
grant execute on function private.effective_document_access_level(uuid, uuid, uuid)
  to service_role;
grant execute on function private.authenticated_can_access_folder(uuid, uuid)
  to authenticated;
grant execute on function private.authenticated_can_access_document(uuid, uuid)
  to authenticated;

create or replace function public.get_folder_access_level(
  target_org_id uuid,
  target_folder_id uuid,
  target_actor_user_id uuid
)
returns public.resource_access_level
language sql
stable
security invoker
set search_path = ''
as $$
  select private.effective_folder_access_level(
    target_org_id,
    target_folder_id,
    target_actor_user_id
  );
$$;

create or replace function public.get_document_access_level(
  target_org_id uuid,
  target_document_id uuid,
  target_actor_user_id uuid
)
returns public.resource_access_level
language sql
stable
security invoker
set search_path = ''
as $$
  select private.effective_document_access_level(
    target_org_id,
    target_document_id,
    target_actor_user_id
  );
$$;

revoke all on function public.get_folder_access_level(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_document_access_level(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_folder_access_level(uuid, uuid, uuid)
  to service_role;
grant execute on function public.get_document_access_level(uuid, uuid, uuid)
  to service_role;

comment on function private.effective_folder_access_level(uuid, uuid, uuid) is
  'Returns cycle-safe additive access inherited from a folder and all ancestors for one active organization actor.';
comment on function private.effective_document_access_level(uuid, uuid, uuid) is
  'Returns additive direct and inherited document access for one active organization actor.';
comment on function public.get_folder_access_level(uuid, uuid, uuid) is
  'Service-only access lookup with an explicit actor UUID; does not trust auth.uid().';
comment on function public.get_document_access_level(uuid, uuid, uuid) is
  'Service-only access lookup with an explicit actor UUID; does not trust auth.uid().';

create or replace function private.prevent_folder_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  creates_cycle boolean;
  parent_lifecycle_state public.resource_lifecycle_state;
begin
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then
    raise exception 'Folders cannot move between organizations.'
      using errcode = '23514';
  end if;

  -- Row triggers run after PostgreSQL locks the tuple. Never wait for the
  -- lifecycle lock here: failing with a serialization error avoids reversing
  -- the advisory-then-row order used by recursive lifecycle RPCs.
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('folder-tree:' || new.org_id::text, 0)
  ) then
    raise exception 'Folder hierarchy changed concurrently; retry the operation.'
      using errcode = '40001';
  end if;

  if new.parent_folder_id is null then
    return new;
  end if;

  if new.parent_folder_id = new.id then
    raise exception 'A folder cannot be its own parent.'
      using errcode = '23514';
  end if;

  select parent.lifecycle_state
  into parent_lifecycle_state
  from public.folders parent
  where parent.id = new.parent_folder_id
    and parent.org_id = new.org_id;

  if not found then
    raise exception 'Parent folder not found.'
      using errcode = 'P0002';
  end if;

  if parent_lifecycle_state <> 'active' then
    raise exception 'Folders may only be assigned to active parents.'
      using errcode = 'P0001';
  end if;

  with recursive parent_lineage as (
    select
      folder.id,
      folder.parent_folder_id,
      array[folder.id]::uuid[] as visited_ids
    from public.folders folder
    where folder.id = new.parent_folder_id
      and folder.org_id = new.org_id

    union all

    select
      parent.id,
      parent.parent_folder_id,
      lineage.visited_ids || parent.id
    from parent_lineage lineage
    join public.folders parent
      on parent.id = lineage.parent_folder_id
     and parent.org_id = new.org_id
    where not parent.id = any(lineage.visited_ids)
  )
  select exists (
    select 1
    from parent_lineage lineage
    where lineage.id = new.id
  )
  into creates_cycle;

  if creates_cycle then
    raise exception 'Folder hierarchy cycles are not allowed.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_folder_cycle()
  from public, anon, authenticated, service_role;

drop trigger if exists folders_prevent_cycle on public.folders;
create trigger folders_prevent_cycle
  before insert or update of org_id, parent_folder_id
  on public.folders
  for each row execute function private.prevent_folder_cycle();

create or replace function private.serialize_document_folder_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_lifecycle_state public.resource_lifecycle_state;
begin
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then
    raise exception 'Documents cannot move between organizations.'
      using errcode = '23514';
  end if;

  -- Folder lifecycle RPCs acquire this lock before discovering descendants.
  -- A row trigger cannot safely wait after its document tuple is locked, so a
  -- concurrent assignment is retried instead.
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('folder-tree:' || new.org_id::text, 0)
  ) then
    raise exception 'Document folder assignment changed concurrently; retry the operation.'
      using errcode = '40001';
  end if;

  if new.folder_id is null then
    return new;
  end if;

  select folder.lifecycle_state
  into parent_lifecycle_state
  from public.folders folder
  where folder.id = new.folder_id
    and folder.org_id = new.org_id;

  if not found then
    raise exception 'Folder not found.'
      using errcode = 'P0002';
  end if;

  if parent_lifecycle_state <> 'active' then
    raise exception 'Documents may only be assigned to active folders.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function private.serialize_document_folder_assignment()
  from public, anon, authenticated, service_role;

drop trigger if exists documents_serialize_folder_assignment
  on public.documents;
create trigger documents_serialize_folder_assignment
  before insert or update of org_id, folder_id
  on public.documents
  for each row execute function private.serialize_document_folder_assignment();

drop policy if exists folders_select_member on public.folders;
drop policy if exists documents_select_member on public.documents;
drop policy if exists document_versions_select_member
  on public.document_versions;
drop policy if exists document_comments_select_member
  on public.document_comments;
drop policy if exists document_activity_events_select_member
  on public.document_activity_events;
drop policy if exists document_answers_select_member
  on public.document_answers;
drop policy if exists document_signing_recipients_select_member
  on public.document_signing_recipients;
drop policy if exists document_recent_accesses_select_own
  on public.document_recent_accesses;
drop policy if exists generated_document_finalizations_select_member
  on public.generated_document_finalizations;

create policy folders_select_acl
  on public.folders
  for select
  to authenticated
  using (
    (select private.authenticated_can_access_folder(org_id, id))
  );

create policy documents_select_acl
  on public.documents
  for select
  to authenticated
  using (
    (select private.authenticated_can_access_document(org_id, id))
  );

create policy document_versions_select_parent_acl
  on public.document_versions
  for select
  to authenticated
  using (
    (select private.authenticated_can_access_document(org_id, document_id))
  );

create policy document_comments_select_parent_acl
  on public.document_comments
  for select
  to authenticated
  using (
    (select private.authenticated_can_access_document(org_id, document_id))
  );

create policy document_activity_events_select_parent_acl
  on public.document_activity_events
  for select
  to authenticated
  using (
    (select private.authenticated_can_access_document(org_id, document_id))
  );

create policy document_answers_select_parent_acl
  on public.document_answers
  for select
  to authenticated
  using (
    (select private.authenticated_can_access_document(org_id, document_id))
  );

create policy document_signing_recipients_select_parent_acl
  on public.document_signing_recipients
  for select
  to authenticated
  using (
    (select private.authenticated_can_access_document(org_id, document_id))
  );

create policy document_recent_accesses_select_own_acl
  on public.document_recent_accesses
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.authenticated_can_access_document(org_id, document_id))
  );

create policy generated_document_finalizations_select_parent_acl
  on public.generated_document_finalizations
  for select
  to authenticated
  using (
    (select private.authenticated_can_access_document(org_id, document_id))
  );

alter table public.document_activity_events
  drop constraint if exists document_activity_events_type_check;

alter table public.document_activity_events
  add constraint document_activity_events_type_check
  check (
    event_type in (
      'document.uploaded',
      'document.replaced',
      'document.commented',
      'document.archived',
      'document.restored',
      'document.trashed',
      'document.finalized'
    )
  );

create or replace function private.require_active_lifecycle_actor(
  target_org_id uuid,
  target_actor_user_id uuid
)
returns public.organization_role
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.organization_role;
begin
  -- Match parent-to-child FK cascade order before locking membership and
  -- resource rows, preventing organization deletion from deadlocking a
  -- lifecycle transition.
  perform organization.id
  from public.organizations organization
  where organization.id = target_org_id
  for key share;

  if not found then
    raise exception 'Organization not found.'
      using errcode = 'P0002';
  end if;

  perform profile.id
  from public.profiles profile
  where profile.id = target_actor_user_id
  for key share;

  if not found then
    raise exception 'Actor profile not found.'
      using errcode = 'P0002';
  end if;

  select membership.role
  into actor_role
  from public.organization_memberships membership
  where membership.org_id = target_org_id
    and membership.user_id = target_actor_user_id
    and membership.status = 'active'
  for update;

  if not found then
    raise exception 'An active organization membership is required.'
      using errcode = '42501';
  end if;

  return actor_role;
end;
$$;

create or replace function private.document_requires_retention(
  target_org_id uuid,
  target_document_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.document_answers answer
      where answer.org_id = target_org_id
        and answer.document_id = target_document_id
        and answer.workflow_status = 'completed'
    )
    or exists (
      select 1
      from public.document_signing_recipients recipient
      where recipient.org_id = target_org_id
        and recipient.document_id = target_document_id
        and recipient.status = 'signed'
    )
    or exists (
      select 1
      from public.generated_document_finalizations finalization
      where finalization.org_id = target_org_id
        and finalization.document_id = target_document_id
        and finalization.status = 'finalized'
    );
$$;

revoke all on function private.require_active_lifecycle_actor(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.document_requires_retention(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.require_active_lifecycle_actor(uuid, uuid)
  to service_role;
grant execute on function private.document_requires_retention(uuid, uuid)
  to service_role;

create or replace function private.enforce_active_document_child_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_document_id uuid;
  parent_org_id uuid;
  parent_lifecycle_state public.resource_lifecycle_state;
begin
  if tg_op = 'DELETE' then
    parent_document_id := old.document_id;
    parent_org_id := old.org_id;
  else
    parent_document_id := new.document_id;
    parent_org_id := new.org_id;
  end if;

  select document.lifecycle_state
  into parent_lifecycle_state
  from public.documents document
  where document.id = parent_document_id
    and document.org_id = parent_org_id
  for key share;

  if not found then
    -- Parent DELETE cascades run after the parent row is no longer visible.
    if tg_op = 'DELETE' then
      return old;
    end if;

    raise exception 'Document not found.'
      using errcode = 'P0002';
  end if;

  if parent_lifecycle_state <> 'active' then
    raise exception 'Only active documents may be modified.'
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function private.prevent_retention_evidence_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  retention_state text;
begin
  retention_state := case tg_table_name
    when 'document_answers' then to_jsonb(old) ->> 'workflow_status'
    else to_jsonb(old) ->> 'status'
  end;

  if (tg_table_name = 'document_answers' and retention_state = 'completed')
      or (
        tg_table_name = 'document_signing_recipients'
        and retention_state = 'signed'
      )
      or (
        tg_table_name = 'generated_document_finalizations'
        and retention_state = 'finalized'
      ) then
    if not exists (
      select 1
      from public.documents document
      where document.id = old.document_id
        and document.org_id = old.org_id
    ) then
      return old;
    end if;

    raise exception 'Completed, signed, and finalized evidence cannot be deleted.'
      using errcode = '23514';
  end if;

  return old;
end;
$$;

create or replace function private.prevent_retention_evidence_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_retention_state text;
  new_retention_state text;
  signed_user_cleanup boolean := false;
begin
  if new.org_id is distinct from old.org_id
      or new.document_id is distinct from old.document_id then
    raise exception 'Document retention evidence identity is immutable.'
      using errcode = '23514';
  end if;

  old_retention_state := case tg_table_name
    when 'document_answers' then to_jsonb(old) ->> 'workflow_status'
    else to_jsonb(old) ->> 'status'
  end;
  new_retention_state := case tg_table_name
    when 'document_answers' then to_jsonb(new) ->> 'workflow_status'
    else to_jsonb(new) ->> 'status'
  end;

  if tg_table_name = 'document_signing_recipients'
      and old_retention_state = 'signed' then
    signed_user_cleanup :=
      old.user_id is not null
      and new.user_id is null
      and not exists (
        select 1
        from public.profiles old_profile
        where old_profile.id = old.user_id
      );

    if (
      to_jsonb(new) - 'user_id'
    ) is distinct from (
      to_jsonb(old) - 'user_id'
    ) or (
      new.user_id is distinct from old.user_id
      and not signed_user_cleanup
    ) then
      raise exception 'Signed recipient evidence is immutable.'
        using errcode = '23514';
    end if;
  elsif old_retention_state in ('completed', 'finalized')
      and new_retention_state is distinct from old_retention_state then
    raise exception 'Completed and finalized evidence state is immutable.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_active_document_content_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.lifecycle_state <> 'active'
      or new.lifecycle_state <> 'active' then
    -- Preserve the existing composite FK's ON DELETE SET NULL cleanup. This is
    -- not a user move: every guarded content field is unchanged and the old
    -- parent has already been deleted by the referential action.
    if old.folder_id is not null
        and new.folder_id is null
        and new.title is not distinct from old.title
        and new.description is not distinct from old.description
        and new.current_version_id is not distinct from old.current_version_id
        and new.lifecycle_state is not distinct from old.lifecycle_state
        and not exists (
          select 1
          from public.folders old_parent
          where old_parent.id = old.folder_id
            and old_parent.org_id = old.org_id
        ) then
      return new;
    end if;

    raise exception 'Only active documents may be modified.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_active_folder_content_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.lifecycle_state <> 'active'
      or new.lifecycle_state <> 'active' then
    -- Allow only the FK-driven detach caused by deleting the old parent.
    if old.parent_folder_id is not null
        and new.parent_folder_id is null
        and new.name is not distinct from old.name
        and new.lifecycle_state is not distinct from old.lifecycle_state
        and not exists (
          select 1
          from public.folders old_parent
          where old_parent.id = old.parent_folder_id
            and old_parent.org_id = old.org_id
        ) then
      return new;
    end if;

    raise exception 'Only active folders may be modified.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_active_document_child_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_retention_evidence_deletion()
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_retention_evidence_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_active_document_content_update()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_active_folder_content_update()
  from public, anon, authenticated, service_role;

drop trigger if exists documents_require_active_content_update
  on public.documents;
create trigger documents_require_active_content_update
  before update of folder_id, title, description, current_version_id
  on public.documents
  for each row execute function private.enforce_active_document_content_update();

drop trigger if exists folders_require_active_content_update
  on public.folders;
create trigger folders_require_active_content_update
  before update of parent_folder_id, name
  on public.folders
  for each row execute function private.enforce_active_folder_content_update();

drop trigger if exists document_versions_require_active_document
  on public.document_versions;
create trigger document_versions_require_active_document
  before insert or update of
    org_id,
    document_id,
    version_number,
    status,
    storage_key,
    original_filename,
    content_type,
    byte_size,
    checksum_sha256
  on public.document_versions
  for each row execute function private.enforce_active_document_child_mutation();

drop trigger if exists document_comments_require_active_document
  on public.document_comments;
create trigger document_comments_require_active_document
  before insert or update of org_id, document_id, body
  on public.document_comments
  for each row execute function private.enforce_active_document_child_mutation();

drop trigger if exists document_answers_require_active_document
  on public.document_answers;
create trigger document_answers_require_active_document
  before insert or update of
    org_id,
    document_id,
    values,
    workflow_status
    or delete
  on public.document_answers
  for each row execute function private.enforce_active_document_child_mutation();

drop trigger if exists document_answers_prevent_retention_evidence_delete
  on public.document_answers;
create trigger document_answers_prevent_retention_evidence_delete
  before delete on public.document_answers
  for each row execute function private.prevent_retention_evidence_deletion();

drop trigger if exists document_answers_prevent_retention_evidence_mutation
  on public.document_answers;
create trigger document_answers_prevent_retention_evidence_mutation
  before update on public.document_answers
  for each row execute function private.prevent_retention_evidence_mutation();

drop trigger if exists document_signing_recipients_require_active_document
  on public.document_signing_recipients;
create trigger document_signing_recipients_require_active_document
  before insert or update of
    org_id,
    document_id,
    name,
    email,
    requires_signature,
    status,
    token_hash,
    token_expires_at,
    invited_at,
    viewed_at,
    signed_at,
    signature_data,
    initials_data
    or delete
  on public.document_signing_recipients
  for each row execute function private.enforce_active_document_child_mutation();

drop trigger if exists document_signing_recipients_prevent_retention_evidence_delete
  on public.document_signing_recipients;
create trigger document_signing_recipients_prevent_retention_evidence_delete
  before delete on public.document_signing_recipients
  for each row execute function private.prevent_retention_evidence_deletion();

drop trigger if exists document_signing_recipients_prevent_retention_evidence_mutation
  on public.document_signing_recipients;
create trigger document_signing_recipients_prevent_retention_evidence_mutation
  before update on public.document_signing_recipients
  for each row execute function private.prevent_retention_evidence_mutation();

drop trigger if exists document_recent_accesses_require_active_document
  on public.document_recent_accesses;
create trigger document_recent_accesses_require_active_document
  before insert or update of
    org_id,
    document_id,
    last_opened_at
  on public.document_recent_accesses
  for each row execute function private.enforce_active_document_child_mutation();

drop trigger if exists generated_document_finalizations_require_active_document
  on public.generated_document_finalizations;
create trigger generated_document_finalizations_require_active_document
  before insert or update of
    org_id,
    document_id,
    status,
    storage_key,
    render_input_sha256,
    pdf_sha256,
    byte_size,
    document_version_id,
    finalized_at
    or delete
  on public.generated_document_finalizations
  for each row execute function private.enforce_active_document_child_mutation();

drop trigger if exists generated_document_finalizations_prevent_retention_evidence_delete
  on public.generated_document_finalizations;
create trigger generated_document_finalizations_prevent_retention_evidence_delete
  before delete on public.generated_document_finalizations
  for each row execute function private.prevent_retention_evidence_deletion();

drop trigger if exists generated_document_finalizations_prevent_retention_evidence_mutation
  on public.generated_document_finalizations;
create trigger generated_document_finalizations_prevent_retention_evidence_mutation
  before update on public.generated_document_finalizations
  for each row execute function private.prevent_retention_evidence_mutation();

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
  actor_role public.organization_role;
  current_lifecycle_state public.resource_lifecycle_state;
begin
  actor_role := private.require_active_lifecycle_actor(
    target_org_id,
    target_actor_user_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('folder-tree:' || target_org_id::text, 0)
  );

  select document.lifecycle_state
  into current_lifecycle_state
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Document not found.'
      using errcode = 'P0002';
  end if;

  if actor_role not in ('owner_admin', 'manager')
      or private.effective_document_access_level(
        target_org_id,
        target_document_id,
        target_actor_user_id
      ) is distinct from 'contributor'::public.resource_access_level then
    raise exception 'Contributor access and a manager role are required.'
      using errcode = '42501';
  end if;

  if current_lifecycle_state = 'archived' then
    return false;
  end if;

  if current_lifecycle_state <> 'active' then
    raise exception 'Only active documents may be archived.'
      using errcode = 'P0001';
  end if;

  update public.documents document
  set lifecycle_state = 'archived',
      archived_at = now(),
      archived_by = target_actor_user_id,
      trashed_by = null,
      trashed_at = null,
      purge_after = null,
      pre_trash_lifecycle_state = null,
      trash_operation_id = null,
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

create or replace function public.restore_document(
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
  actor_role public.organization_role;
  current_lifecycle_state public.resource_lifecycle_state;
  restored_lifecycle_state public.resource_lifecycle_state;
begin
  actor_role := private.require_active_lifecycle_actor(
    target_org_id,
    target_actor_user_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('folder-tree:' || target_org_id::text, 0)
  );

  select
    document.lifecycle_state,
    case
      when document.lifecycle_state = 'archived' then 'active'
      when document.lifecycle_state = 'trashed'
        then document.pre_trash_lifecycle_state
      else null
    end
  into current_lifecycle_state, restored_lifecycle_state
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Document not found.'
      using errcode = 'P0002';
  end if;

  if actor_role not in ('owner_admin', 'manager')
      or private.effective_document_access_level(
        target_org_id,
        target_document_id,
        target_actor_user_id
      ) is distinct from 'contributor'::public.resource_access_level then
    raise exception 'Contributor access and a manager role are required.'
      using errcode = '42501';
  end if;

  if current_lifecycle_state = 'active' then
    return false;
  end if;

  if current_lifecycle_state = 'purge_pending' then
    raise exception 'Purge-pending documents cannot be restored.'
      using errcode = 'P0001';
  end if;

  if restored_lifecycle_state not in ('active', 'archived') then
    raise exception 'Document restore metadata is invalid.'
      using errcode = '23514';
  end if;

  if current_lifecycle_state = 'trashed'
      and exists (
        select 1
        from private.resource_trash_operations operation
        where operation.org_id = target_org_id
          and operation.operation_id = (
            select document.trash_operation_id
            from public.documents document
            where document.id = target_document_id
              and document.org_id = target_org_id
          )
          and operation.root_resource_kind = 'folder'
      ) then
    raise exception 'Restore the containing folder to restore this document.'
      using errcode = 'P0001';
  end if;

  update public.documents document
  set lifecycle_state = restored_lifecycle_state,
      archived_at = case
        when restored_lifecycle_state = 'active' then null
        else document.archived_at
      end,
      archived_by = case
        when restored_lifecycle_state = 'active' then null
        else document.archived_by
      end,
      trashed_by = null,
      trashed_at = null,
      purge_after = null,
      pre_trash_lifecycle_state = null,
      trash_operation_id = null,
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
    'document.restored',
    jsonb_build_object('restoredState', restored_lifecycle_state)
  );

  return true;
end;
$$;

create or replace function public.trash_document(
  target_org_id uuid,
  target_document_id uuid,
  target_actor_user_id uuid,
  target_trash_operation_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_role public.organization_role;
  current_lifecycle_state public.resource_lifecycle_state;
  transition_at timestamptz := now();
  protected_from_automatic_purge boolean;
  calculated_purge_after timestamptz;
begin
  if target_trash_operation_id is null then
    raise exception 'A trash operation ID is required.'
      using errcode = '22023';
  end if;

  actor_role := private.require_active_lifecycle_actor(
    target_org_id,
    target_actor_user_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('folder-tree:' || target_org_id::text, 0)
  );

  select document.lifecycle_state
  into current_lifecycle_state
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Document not found.'
      using errcode = 'P0002';
  end if;

  if actor_role not in ('owner_admin', 'manager')
      or private.effective_document_access_level(
        target_org_id,
        target_document_id,
        target_actor_user_id
      ) is distinct from 'contributor'::public.resource_access_level then
    raise exception 'Contributor access and a manager role are required.'
      using errcode = '42501';
  end if;

  if current_lifecycle_state = 'trashed' then
    return false;
  end if;

  if current_lifecycle_state = 'purge_pending' then
    raise exception 'Purge-pending documents cannot be trashed again.'
      using errcode = 'P0001';
  end if;

  insert into private.resource_trash_operations (
    org_id,
    operation_id,
    root_resource_kind,
    root_resource_id,
    actor_user_id
  )
  values (
    target_org_id,
    target_trash_operation_id,
    'document',
    target_document_id,
    target_actor_user_id
  );

  protected_from_automatic_purge := private.document_requires_retention(
    target_org_id,
    target_document_id
  );
  calculated_purge_after := case
    when protected_from_automatic_purge then null
    else transition_at + interval '30 days'
  end;

  update public.documents document
  set lifecycle_state = 'trashed',
      archived_at = coalesce(document.archived_at, transition_at),
      archived_by = coalesce(document.archived_by, target_actor_user_id),
      trashed_by = target_actor_user_id,
      trashed_at = transition_at,
      purge_after = calculated_purge_after,
      pre_trash_lifecycle_state = current_lifecycle_state,
      trash_operation_id = target_trash_operation_id,
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
    'document.trashed',
    jsonb_build_object(
      'trashOperationId',
      target_trash_operation_id,
      'purgeAfter',
      calculated_purge_after,
      'retentionProtected',
      protected_from_automatic_purge
    )
  );

  return true;
end;
$$;

create or replace function public.archive_folder(
  target_org_id uuid,
  target_folder_id uuid,
  target_actor_user_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_role public.organization_role;
  current_lifecycle_state public.resource_lifecycle_state;
begin
  actor_role := private.require_active_lifecycle_actor(
    target_org_id,
    target_actor_user_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('folder-tree:' || target_org_id::text, 0)
  );

  select folder.lifecycle_state
  into current_lifecycle_state
  from public.folders folder
  where folder.id = target_folder_id
    and folder.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Folder not found.'
      using errcode = 'P0002';
  end if;

  if actor_role not in ('owner_admin', 'manager')
      or private.effective_folder_access_level(
        target_org_id,
        target_folder_id,
        target_actor_user_id
      ) is distinct from 'contributor'::public.resource_access_level then
    raise exception 'Contributor access and a manager role are required.'
      using errcode = '42501';
  end if;

  if current_lifecycle_state = 'archived' then
    return false;
  end if;

  if current_lifecycle_state <> 'active' then
    raise exception 'Only active folders may be archived.'
      using errcode = 'P0001';
  end if;

  update public.folders folder
  set lifecycle_state = 'archived',
      archived_at = now(),
      archived_by = target_actor_user_id,
      trashed_by = null,
      trashed_at = null,
      purge_after = null,
      pre_trash_lifecycle_state = null,
      trash_operation_id = null,
      updated_by = target_actor_user_id
  where folder.id = target_folder_id
    and folder.org_id = target_org_id;

  -- Keep this insert last: the audit-chain trigger takes the transaction's
  -- final advisory lock.
  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    target_org_id,
    target_actor_user_id,
    'folder.archived',
    'folder',
    target_folder_id,
    '{}'::jsonb
  );

  return true;
end;
$$;

create or replace function public.restore_folder(
  target_org_id uuid,
  target_folder_id uuid,
  target_actor_user_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_role public.organization_role;
  current_lifecycle_state public.resource_lifecycle_state;
  root_trash_operation_id uuid;
  folder_ids uuid[] := '{}'::uuid[];
  document_ids uuid[] := '{}'::uuid[];
  restored_folder_count integer := 0;
  restored_document_count integer := 0;
begin
  actor_role := private.require_active_lifecycle_actor(
    target_org_id,
    target_actor_user_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('folder-tree:' || target_org_id::text, 0)
  );

  select folder.lifecycle_state, folder.trash_operation_id
  into current_lifecycle_state, root_trash_operation_id
  from public.folders folder
  where folder.id = target_folder_id
    and folder.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Folder not found.'
      using errcode = 'P0002';
  end if;

  if actor_role not in ('owner_admin', 'manager')
      or private.effective_folder_access_level(
        target_org_id,
        target_folder_id,
        target_actor_user_id
      ) is distinct from 'contributor'::public.resource_access_level then
    raise exception 'Contributor access and a manager role are required.'
      using errcode = '42501';
  end if;

  if current_lifecycle_state = 'active' then
    return false;
  end if;

  if current_lifecycle_state = 'purge_pending' then
    raise exception 'Purge-pending folders cannot be restored.'
      using errcode = 'P0001';
  end if;

  if current_lifecycle_state = 'archived' then
    update public.folders folder
    set lifecycle_state = 'active',
        archived_at = null,
        archived_by = null,
        trashed_by = null,
        trashed_at = null,
        purge_after = null,
        pre_trash_lifecycle_state = null,
        trash_operation_id = null,
        updated_by = target_actor_user_id
    where folder.id = target_folder_id
      and folder.org_id = target_org_id;

    insert into public.audit_logs (
      org_id,
      actor_user_id,
      action,
      target_type,
      target_id,
      metadata
    )
    values (
      target_org_id,
      target_actor_user_id,
      'folder.restored',
      'folder',
      target_folder_id,
      jsonb_build_object(
        'restoredFolderCount',
        1,
        'restoredDocumentCount',
        0
      )
    );

    return true;
  end if;

  if root_trash_operation_id is null then
    raise exception 'Folder restore metadata is invalid.'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from private.resource_trash_operations operation
    where operation.org_id = target_org_id
      and operation.operation_id = root_trash_operation_id
      and operation.root_resource_kind = 'folder'
      and operation.root_resource_id = target_folder_id
  ) then
    raise exception 'Folder restore operation metadata is invalid.'
      using errcode = '23514';
  end if;

  with recursive restore_subtree as (
    select folder.id
    from public.folders folder
    where folder.id = target_folder_id
      and folder.org_id = target_org_id
      and folder.lifecycle_state = 'trashed'
      and folder.trash_operation_id = root_trash_operation_id

    union all

    select child.id
    from restore_subtree parent
    join public.folders child
      on child.parent_folder_id = parent.id
     and child.org_id = target_org_id
    where child.lifecycle_state = 'trashed'
      and child.trash_operation_id = root_trash_operation_id
  )
  select coalesce(array_agg(subtree.id order by subtree.id), '{}'::uuid[])
  into folder_ids
  from restore_subtree subtree;

  perform folder.id
  from public.folders folder
  where folder.org_id = target_org_id
    and folder.id = any(folder_ids)
  order by folder.id
  for update;

  select coalesce(array_agg(document.id order by document.id), '{}'::uuid[])
  into document_ids
  from public.documents document
  where document.org_id = target_org_id
    and document.folder_id = any(folder_ids)
    and document.lifecycle_state = 'trashed'
    and document.trash_operation_id = root_trash_operation_id;

  perform document.id
  from public.documents document
  where document.org_id = target_org_id
    and document.id = any(document_ids)
  order by document.id
  for update;

  restored_folder_count := coalesce(cardinality(folder_ids), 0);
  restored_document_count := coalesce(cardinality(document_ids), 0);

  update public.documents document
  set lifecycle_state = document.pre_trash_lifecycle_state,
      archived_at = case
        when document.pre_trash_lifecycle_state = 'active' then null
        else document.archived_at
      end,
      archived_by = case
        when document.pre_trash_lifecycle_state = 'active' then null
        else document.archived_by
      end,
      trashed_by = null,
      trashed_at = null,
      purge_after = null,
      pre_trash_lifecycle_state = null,
      trash_operation_id = null,
      updated_by = target_actor_user_id
  where document.org_id = target_org_id
    and document.id = any(document_ids);

  update public.folders folder
  set lifecycle_state = folder.pre_trash_lifecycle_state,
      archived_at = case
        when folder.pre_trash_lifecycle_state = 'active' then null
        else folder.archived_at
      end,
      archived_by = case
        when folder.pre_trash_lifecycle_state = 'active' then null
        else folder.archived_by
      end,
      trashed_by = null,
      trashed_at = null,
      purge_after = null,
      pre_trash_lifecycle_state = null,
      trash_operation_id = null,
      updated_by = target_actor_user_id
  where folder.org_id = target_org_id
    and folder.id = any(folder_ids);

  insert into public.document_activity_events (
    id,
    org_id,
    document_id,
    actor_user_id,
    event_type,
    metadata
  )
  select
    gen_random_uuid(),
    document.org_id,
    document.id,
    target_actor_user_id,
    'document.restored',
    jsonb_build_object(
      'restoredState',
      document.lifecycle_state,
      'trashOperationId',
      root_trash_operation_id
    )
  from public.documents document
  where document.org_id = target_org_id
    and document.id = any(document_ids);

  -- Keep this insert last: the audit-chain trigger takes the transaction's
  -- final advisory lock.
  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    target_org_id,
    target_actor_user_id,
    'folder.restored',
    'folder',
    target_folder_id,
    jsonb_build_object(
      'trashOperationId',
      root_trash_operation_id,
      'restoredFolderCount',
      restored_folder_count,
      'restoredDocumentCount',
      restored_document_count
    )
  );

  return true;
end;
$$;

create or replace function public.trash_folder(
  target_org_id uuid,
  target_folder_id uuid,
  target_actor_user_id uuid,
  target_trash_operation_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_role public.organization_role;
  current_lifecycle_state public.resource_lifecycle_state;
  transition_at timestamptz := now();
  folder_ids uuid[] := '{}'::uuid[];
  physical_folder_ids uuid[] := '{}'::uuid[];
  document_ids uuid[] := '{}'::uuid[];
  trashed_folder_count integer := 0;
  trashed_document_count integer := 0;
  has_protected_documents boolean := false;
  folder_purge_after timestamptz;
begin
  if target_trash_operation_id is null then
    raise exception 'A trash operation ID is required.'
      using errcode = '22023';
  end if;

  actor_role := private.require_active_lifecycle_actor(
    target_org_id,
    target_actor_user_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('folder-tree:' || target_org_id::text, 0)
  );

  select folder.lifecycle_state
  into current_lifecycle_state
  from public.folders folder
  where folder.id = target_folder_id
    and folder.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Folder not found.'
      using errcode = 'P0002';
  end if;

  if actor_role not in ('owner_admin', 'manager')
      or private.effective_folder_access_level(
        target_org_id,
        target_folder_id,
        target_actor_user_id
      ) is distinct from 'contributor'::public.resource_access_level then
    raise exception 'Contributor access and a manager role are required.'
      using errcode = '42501';
  end if;

  if current_lifecycle_state = 'trashed' then
    return false;
  end if;

  if current_lifecycle_state = 'purge_pending' then
    raise exception 'Purge-pending folders cannot be trashed again.'
      using errcode = 'P0001';
  end if;

  insert into private.resource_trash_operations (
    org_id,
    operation_id,
    root_resource_kind,
    root_resource_id,
    actor_user_id
  )
  values (
    target_org_id,
    target_trash_operation_id,
    'folder',
    target_folder_id,
    target_actor_user_id
  );

  -- A previously trashed child is a restoration boundary. Its descendants are
  -- not stamped with this operation ID and therefore cannot be revived later.
  with recursive trash_subtree as (
    select folder.id
    from public.folders folder
    where folder.id = target_folder_id
      and folder.org_id = target_org_id
      and folder.lifecycle_state in ('active', 'archived')

    union all

    select child.id
    from trash_subtree parent
    join public.folders child
      on child.parent_folder_id = parent.id
     and child.org_id = target_org_id
    where child.lifecycle_state in ('active', 'archived')
  )
  select coalesce(array_agg(subtree.id order by subtree.id), '{}'::uuid[])
  into folder_ids
  from trash_subtree subtree;

  -- Retention protection follows the physical hierarchy without lifecycle
  -- boundaries. A previously trashed signed/completed descendant must keep an
  -- ancestor folder from receiving an automatic purge deadline.
  with recursive physical_subtree as (
    select folder.id
    from public.folders folder
    where folder.id = target_folder_id
      and folder.org_id = target_org_id

    union all

    select child.id
    from physical_subtree parent
    join public.folders child
      on child.parent_folder_id = parent.id
     and child.org_id = target_org_id
  )
  select coalesce(array_agg(subtree.id order by subtree.id), '{}'::uuid[])
  into physical_folder_ids
  from physical_subtree subtree;

  perform folder.id
  from public.folders folder
  where folder.org_id = target_org_id
    and folder.id = any(folder_ids)
  order by folder.id
  for update;

  select coalesce(array_agg(document.id order by document.id), '{}'::uuid[])
  into document_ids
  from public.documents document
  where document.org_id = target_org_id
    and document.folder_id = any(folder_ids)
    and document.lifecycle_state in ('active', 'archived');

  perform document.id
  from public.documents document
  where document.org_id = target_org_id
    and document.id = any(document_ids)
  order by document.id
  for update;

  select exists (
    select 1
    from public.documents document
    where document.org_id = target_org_id
      and document.folder_id = any(physical_folder_ids)
      and private.document_requires_retention(
        target_org_id,
        document.id
      )
  )
  into has_protected_documents;

  folder_purge_after := case
    when has_protected_documents then null
    else transition_at + interval '30 days'
  end;
  trashed_folder_count := coalesce(cardinality(folder_ids), 0);
  trashed_document_count := coalesce(cardinality(document_ids), 0);

  update public.documents document
  set lifecycle_state = 'trashed',
      archived_at = coalesce(document.archived_at, transition_at),
      archived_by = coalesce(document.archived_by, target_actor_user_id),
      trashed_by = target_actor_user_id,
      trashed_at = transition_at,
      purge_after = case
        when private.document_requires_retention(target_org_id, document.id)
          then null
        else transition_at + interval '30 days'
      end,
      pre_trash_lifecycle_state = document.lifecycle_state,
      trash_operation_id = target_trash_operation_id,
      updated_by = target_actor_user_id
  where document.org_id = target_org_id
    and document.id = any(document_ids);

  update public.folders folder
  set lifecycle_state = 'trashed',
      archived_at = coalesce(folder.archived_at, transition_at),
      archived_by = coalesce(folder.archived_by, target_actor_user_id),
      trashed_by = target_actor_user_id,
      trashed_at = transition_at,
      purge_after = folder_purge_after,
      pre_trash_lifecycle_state = folder.lifecycle_state,
      trash_operation_id = target_trash_operation_id,
      updated_by = target_actor_user_id
  where folder.org_id = target_org_id
    and folder.id = any(folder_ids);

  insert into public.document_activity_events (
    id,
    org_id,
    document_id,
    actor_user_id,
    event_type,
    metadata
  )
  select
    gen_random_uuid(),
    document.org_id,
    document.id,
    target_actor_user_id,
    'document.trashed',
    jsonb_build_object(
      'trashOperationId',
      target_trash_operation_id,
      'purgeAfter',
      document.purge_after,
      'retentionProtected',
      document.purge_after is null
    )
  from public.documents document
  where document.org_id = target_org_id
    and document.id = any(document_ids);

  -- Keep this insert last: the audit-chain trigger takes the transaction's
  -- final advisory lock.
  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    target_org_id,
    target_actor_user_id,
    'folder.trashed',
    'folder',
    target_folder_id,
    jsonb_build_object(
      'trashOperationId',
      target_trash_operation_id,
      'purgeAfter',
      folder_purge_after,
      'retentionProtected',
      has_protected_documents,
      'trashedFolderCount',
      trashed_folder_count,
      'trashedDocumentCount',
      trashed_document_count
    )
  );

  return true;
end;
$$;

revoke execute on function public.archive_document(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.restore_document(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.trash_document(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.archive_folder(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.restore_folder(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.trash_folder(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.archive_document(uuid, uuid, uuid)
  to service_role;
grant execute on function public.restore_document(uuid, uuid, uuid)
  to service_role;
grant execute on function public.trash_document(uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function public.archive_folder(uuid, uuid, uuid)
  to service_role;
grant execute on function public.restore_folder(uuid, uuid, uuid)
  to service_role;
grant execute on function public.trash_folder(uuid, uuid, uuid, uuid)
  to service_role;

comment on function public.archive_document(uuid, uuid, uuid) is
  'Archives one active document after checking active membership, manager role, and effective contributor access.';
comment on function public.restore_document(uuid, uuid, uuid) is
  'Restores one archived or trashed document; purge-pending documents are irreversible.';
comment on function public.trash_document(uuid, uuid, uuid, uuid) is
  'Moves one document to trash and applies a 30-day purge date unless signed, completed, or finalized.';
comment on function public.archive_folder(uuid, uuid, uuid) is
  'Archives one folder without implicitly changing descendant lifecycle states.';
comment on function public.restore_folder(uuid, uuid, uuid) is
  'Restores one archived folder or the exact recursive subtree stamped by its trash operation.';
comment on function public.trash_folder(uuid, uuid, uuid, uuid) is
  'Atomically trashes an accessible folder subtree while preserving pre-existing trash boundaries.';

notify pgrst, 'reload schema';
