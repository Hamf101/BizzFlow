create table public.organization_roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  system_key public.organization_role,
  name text not null,
  permissions text[],
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, system_key),
  constraint organization_roles_name_length
    check (char_length(name) between 2 and 60),
  constraint organization_roles_owner_access_permanent
    check (
      (system_key = 'owner_admin' and permissions is null)
      or (system_key is distinct from 'owner_admin' and permissions is not null)
    ),
  constraint organization_roles_permissions_supported
    check (
      permissions is null
      or permissions <@ array[
        'people:view',
        'organization:manage',
        'members:invite',
        'members:update_role',
        'audit_logs:view',
        'audit_logs:verify',
        'templates:view',
        'templates:manage',
        'documents:view',
        'documents:send',
        'documents:fill',
        'document_comments:create',
        'documents:create',
        'documents:archive',
        'folders:manage',
        'document_versions:create',
        'submissions:view',
        'submissions:create',
        'submissions:edit',
        'submissions:assign',
        'submissions:review',
        'submission_comments:create',
        'tasks:view',
        'tasks:create',
        'tasks:edit',
        'tasks:assign'
      ]::text[]
    )
);

create unique index organization_roles_active_name_unique_idx
  on public.organization_roles (org_id, lower(name))
  where archived_at is null;

create index organization_roles_org_active_idx
  on public.organization_roles (org_id, created_at, id)
  where archived_at is null;

create trigger organization_roles_set_updated_at
  before update on public.organization_roles
  for each row execute function public.set_updated_at();

create or replace function public.protect_owner_organization_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
      and old.system_key = 'owner_admin'
      and exists (
        select 1
        from public.organizations organization
        where organization.id = old.org_id
      ) then
    raise exception 'Owner access is permanent.'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
      and old.system_key = 'owner_admin'
      and (
        new.org_id is distinct from old.org_id
        or new.system_key is distinct from old.system_key
        or new.permissions is distinct from old.permissions
        or new.archived_at is not null
      ) then
    raise exception 'Owner access is permanent.'
      using errcode = '23514';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger organization_roles_protect_owner
  before update or delete on public.organization_roles
  for each row execute function public.protect_owner_organization_role();

create or replace function public.seed_organization_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_roles (
    org_id,
    system_key,
    name,
    permissions
  )
  values
    (new.id, 'owner_admin', 'Owner', null),
    (
      new.id,
      'manager',
      'Manager',
      array[
        'people:view', 'members:invite', 'audit_logs:view',
        'templates:view', 'templates:manage', 'documents:view',
        'documents:send', 'documents:fill', 'document_comments:create',
        'documents:create', 'documents:archive', 'folders:manage',
        'document_versions:create', 'submissions:view',
        'submissions:create', 'submissions:edit', 'submissions:assign',
        'submissions:review', 'submission_comments:create', 'tasks:view',
        'tasks:create', 'tasks:edit', 'tasks:assign'
      ]::text[]
    ),
    (
      new.id,
      'staff',
      'Staff',
      array[
        'people:view', 'templates:view', 'documents:view',
        'documents:send', 'documents:fill', 'document_comments:create',
        'documents:create', 'document_versions:create', 'submissions:view',
        'submissions:create', 'submissions:edit',
        'submission_comments:create', 'tasks:view', 'tasks:create',
        'tasks:edit'
      ]::text[]
    ),
    (
      new.id,
      'external_reviewer',
      'External Reviewer',
      array[
        'people:view', 'documents:view', 'document_comments:create',
        'submissions:view', 'submission_comments:create'
      ]::text[]
    )
  on conflict (org_id, system_key) do nothing;

  return new;
end;
$$;

create trigger organizations_seed_roles
  after insert on public.organizations
  for each row execute function public.seed_organization_roles();

insert into public.organization_roles (org_id, system_key, name, permissions)
select
  organization.id,
  defaults.system_key,
  defaults.name,
  defaults.permissions
from public.organizations organization
cross join (
  values
    ('owner_admin'::public.organization_role, 'Owner', null::text[]),
    (
      'manager'::public.organization_role,
      'Manager',
      array[
        'people:view', 'members:invite', 'audit_logs:view',
        'templates:view', 'templates:manage', 'documents:view',
        'documents:send', 'documents:fill', 'document_comments:create',
        'documents:create', 'documents:archive', 'folders:manage',
        'document_versions:create', 'submissions:view',
        'submissions:create', 'submissions:edit', 'submissions:assign',
        'submissions:review', 'submission_comments:create', 'tasks:view',
        'tasks:create', 'tasks:edit', 'tasks:assign'
      ]::text[]
    ),
    (
      'staff'::public.organization_role,
      'Staff',
      array[
        'people:view', 'templates:view', 'documents:view',
        'documents:send', 'documents:fill', 'document_comments:create',
        'documents:create', 'document_versions:create', 'submissions:view',
        'submissions:create', 'submissions:edit',
        'submission_comments:create', 'tasks:view', 'tasks:create',
        'tasks:edit'
      ]::text[]
    ),
    (
      'external_reviewer'::public.organization_role,
      'External Reviewer',
      array[
        'people:view', 'documents:view', 'document_comments:create',
        'submissions:view', 'submission_comments:create'
      ]::text[]
    )
) as defaults(system_key, name, permissions)
on conflict (org_id, system_key) do nothing;

alter table public.organization_memberships
  add column role_definition_id uuid,
  add column workspace_display_name text,
  add constraint organization_memberships_workspace_display_name_length
    check (
      workspace_display_name is null
      or char_length(workspace_display_name) between 1 and 120
    );

alter table public.invites
  add column role_definition_id uuid;

update public.organization_memberships membership
set role_definition_id = role_definition.id
from public.organization_roles role_definition
where role_definition.org_id = membership.org_id
  and role_definition.system_key = membership.role;

update public.invites invite
set role_definition_id = role_definition.id
from public.organization_roles role_definition
where role_definition.org_id = invite.org_id
  and role_definition.system_key = invite.role;

alter table public.organization_memberships
  alter column role_definition_id set not null,
  add constraint organization_memberships_role_definition_fk
    foreign key (org_id, role_definition_id)
    references public.organization_roles (org_id, id);

alter table public.invites
  alter column role_definition_id set not null,
  add constraint invites_role_definition_fk
    foreign key (org_id, role_definition_id)
    references public.organization_roles (org_id, id);

create index organization_memberships_role_definition_idx
  on public.organization_memberships (org_id, role_definition_id)
  where status = 'active';

create index invites_role_definition_pending_idx
  on public.invites (org_id, role_definition_id)
  where status = 'pending';

create or replace function public.sync_membership_role_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_role_id uuid;
  selected_system_key public.organization_role;
begin
  selected_role_id := new.role_definition_id;

  if selected_role_id is null
      or (
        tg_op = 'UPDATE'
        and new.role is distinct from old.role
        and new.role_definition_id is not distinct from old.role_definition_id
      ) then
    select role_definition.id
    into selected_role_id
    from public.organization_roles role_definition
    where role_definition.org_id = new.org_id
      and role_definition.system_key = new.role
      and role_definition.archived_at is null;
  end if;

  select role_definition.system_key
  into selected_system_key
  from public.organization_roles role_definition
  where role_definition.id = selected_role_id
    and role_definition.org_id = new.org_id
    and role_definition.archived_at is null;

  if not found then
    raise exception 'That role cannot be assigned.'
      using errcode = '22023';
  end if;

  new.role_definition_id := selected_role_id;
  new.role := case
    when selected_system_key is null then 'staff'::public.organization_role
    else selected_system_key
  end;

  return new;
end;
$$;

create trigger organization_memberships_sync_role_definition
  before insert or update of org_id, role, role_definition_id
  on public.organization_memberships
  for each row execute function public.sync_membership_role_definition();

create or replace function public.sync_invite_role_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_role_id uuid;
  selected_system_key public.organization_role;
begin
  selected_role_id := new.role_definition_id;

  if selected_role_id is null
      or (
        tg_op = 'UPDATE'
        and new.role is distinct from old.role
        and new.role_definition_id is not distinct from old.role_definition_id
      ) then
    select role_definition.id
    into selected_role_id
    from public.organization_roles role_definition
    where role_definition.org_id = new.org_id
      and role_definition.system_key = new.role
      and role_definition.archived_at is null;
  end if;

  select role_definition.system_key
  into selected_system_key
  from public.organization_roles role_definition
  where role_definition.id = selected_role_id
    and role_definition.org_id = new.org_id
    and role_definition.archived_at is null;

  if not found or selected_system_key = 'owner_admin' then
    raise exception 'That role cannot be assigned to an invite.'
      using errcode = '22023';
  end if;

  new.role_definition_id := selected_role_id;
  new.role := case
    when selected_system_key is null then 'staff'::public.organization_role
    else selected_system_key
  end;

  return new;
end;
$$;

create trigger invites_sync_role_definition
  before insert or update of org_id, role, role_definition_id
  on public.invites
  for each row execute function public.sync_invite_role_definition();

create or replace function public.update_organization_member_access(
  target_org_id uuid,
  target_membership_id uuid,
  target_actor_user_id uuid,
  target_role_definition_id uuid,
  target_workspace_display_name text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_role public.organization_role;
  current_role public.organization_role;
  selected_system_key public.organization_role;
  normalized_display_name text;
  updated_membership_id uuid;
begin
  normalized_display_name := nullif(regexp_replace(
    btrim(target_workspace_display_name),
    '\s+',
    ' ',
    'g'
  ), '');

  if normalized_display_name is not null
      and char_length(normalized_display_name) > 120 then
    raise exception 'Workspace display name is too long.'
      using errcode = '22023';
  end if;

  perform 1
  from public.organizations organization
  where organization.id = target_org_id
  for update;

  if not found then
    raise exception 'Organization was not found.'
      using errcode = 'P0002';
  end if;

  select membership.role
  into actor_role
  from public.organization_memberships membership
  where membership.org_id = target_org_id
    and membership.user_id = target_actor_user_id
    and membership.status = 'active';

  if not found or actor_role <> 'owner_admin' then
    raise exception 'Actor cannot update member access.'
      using errcode = '42501';
  end if;

  select membership.role
  into current_role
  from public.organization_memberships membership
  where membership.id = target_membership_id
    and membership.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Member was not found.'
      using errcode = 'P0002';
  end if;

  select role_definition.system_key
  into selected_system_key
  from public.organization_roles role_definition
  where role_definition.id = target_role_definition_id
    and role_definition.org_id = target_org_id
    and role_definition.archived_at is null;

  if not found then
    raise exception 'That role cannot be assigned.'
      using errcode = '22023';
  end if;

  if current_role = 'owner_admin'
      and selected_system_key is distinct from 'owner_admin' then
    raise exception 'Owner access is permanent.'
      using errcode = '23514';
  end if;

  if current_role <> 'owner_admin' and selected_system_key = 'owner_admin' then
    raise exception 'Owner cannot be assigned from member access.'
      using errcode = '22023';
  end if;

  update public.organization_memberships membership
  set role_definition_id = target_role_definition_id,
      workspace_display_name = normalized_display_name
  where membership.id = target_membership_id
    and membership.org_id = target_org_id
  returning membership.id into updated_membership_id;

  return updated_membership_id;
end;
$$;

create or replace function public.archive_organization_role(
  target_org_id uuid,
  target_actor_user_id uuid,
  target_role_definition_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_role public.organization_role;
  selected_system_key public.organization_role;
  archived_role_id uuid;
begin
  perform 1
  from public.organizations organization
  where organization.id = target_org_id
  for update;

  if not found then
    raise exception 'Organization was not found.'
      using errcode = 'P0002';
  end if;

  select membership.role
  into actor_role
  from public.organization_memberships membership
  where membership.org_id = target_org_id
    and membership.user_id = target_actor_user_id
    and membership.status = 'active';

  if not found or actor_role <> 'owner_admin' then
    raise exception 'Actor cannot remove access roles.'
      using errcode = '42501';
  end if;

  select role_definition.system_key
  into selected_system_key
  from public.organization_roles role_definition
  where role_definition.id = target_role_definition_id
    and role_definition.org_id = target_org_id
    and role_definition.archived_at is null
  for update;

  if not found then
    raise exception 'Access role was not found.'
      using errcode = 'P0002';
  end if;

  if selected_system_key = 'owner_admin' then
    raise exception 'Owner access is permanent.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.organization_memberships membership
    where membership.org_id = target_org_id
      and membership.role_definition_id = target_role_definition_id
  ) then
    raise exception 'Role is still assigned to a member.'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from public.invites invite
    where invite.org_id = target_org_id
      and invite.role_definition_id = target_role_definition_id
      and invite.status = 'pending'
      and invite.expires_at > now()
  ) then
    raise exception 'Role is still assigned to an active invite.'
      using errcode = '23503';
  end if;

  update public.organization_roles role_definition
  set archived_at = now()
  where role_definition.id = target_role_definition_id
    and role_definition.org_id = target_org_id
  returning role_definition.id into archived_role_id;

  return archived_role_id;
end;
$$;

create or replace function public.accept_organization_invite(
  target_invite_id uuid,
  target_token text,
  target_user_id uuid,
  target_user_email text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_invite_org_id uuid;
  locked_invite_email text;
  locked_invite_role public.organization_role;
  locked_invite_role_definition_id uuid;
  locked_invite_status public.invite_status;
  locked_invite_expires_at timestamptz;
  normalized_user_email text;
  accepted_membership_id uuid;
begin
  normalized_user_email := lower(btrim(target_user_email));

  if normalized_user_email is null
      or char_length(normalized_user_email) < 3
      or char_length(normalized_user_email) > 320
      or position('@' in normalized_user_email) <= 1 then
    raise exception 'Invite email is invalid.'
      using errcode = '22023';
  end if;

  select
    invite.org_id,
    invite.email,
    invite.role,
    invite.role_definition_id,
    invite.status,
    invite.expires_at
  into
    locked_invite_org_id,
    locked_invite_email,
    locked_invite_role,
    locked_invite_role_definition_id,
    locked_invite_status,
    locked_invite_expires_at
  from public.invites invite
  where invite.id = target_invite_id
    and invite.token = target_token
  for update;

  if not found
      or locked_invite_status <> 'pending'
      or locked_invite_expires_at <= now()
      or locked_invite_email <> normalized_user_email then
    raise exception 'Invite is invalid or expired.'
      using errcode = 'P0002';
  end if;

  insert into public.profiles (id, email)
  values (target_user_id, normalized_user_email)
  on conflict (id)
  do update set email = excluded.email;

  insert into public.organization_memberships (
    org_id,
    user_id,
    role,
    role_definition_id,
    status
  )
  values (
    locked_invite_org_id,
    target_user_id,
    locked_invite_role,
    locked_invite_role_definition_id,
    'active'
  )
  on conflict (org_id, user_id)
  do update
  set role = excluded.role,
      role_definition_id = excluded.role_definition_id,
      status = 'active'
  returning id into accepted_membership_id;

  update public.invites invite
  set status = 'accepted',
      accepted_by = target_user_id,
      accepted_at = now()
  where invite.id = target_invite_id;

  return accepted_membership_id;
end;
$$;

drop function if exists public.get_current_organization_context(uuid);

create function public.get_current_organization_context(
  target_user_id uuid
)
returns table (
  membership_id uuid,
  org_id uuid,
  user_id uuid,
  role text,
  role_definition_id uuid,
  role_definition_name text,
  role_definition_system_key text,
  role_definition_permissions text[],
  workspace_display_name text,
  status text,
  membership_created_at timestamptz,
  membership_updated_at timestamptz,
  organization_name text,
  organization_slug text,
  organization_created_by uuid,
  organization_created_at timestamptz,
  organization_updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    membership.id,
    membership.org_id,
    membership.user_id,
    membership.role::text,
    role_definition.id,
    role_definition.name,
    role_definition.system_key::text,
    role_definition.permissions,
    membership.workspace_display_name,
    membership.status::text,
    membership.created_at,
    membership.updated_at,
    organization.name,
    organization.slug,
    organization.created_by,
    organization.created_at,
    organization.updated_at
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.org_id
  join public.organization_roles role_definition
    on role_definition.id = membership.role_definition_id
    and role_definition.org_id = membership.org_id
  where membership.user_id = target_user_id
    and membership.status = 'active'
  order by membership.created_at asc, membership.id asc
  limit 1
$$;

revoke all on table public.organization_roles from anon, authenticated;
grant select on table public.organization_roles to authenticated;
grant select, insert, update on table public.organization_roles to service_role;

alter table public.organization_roles enable row level security;
alter table public.organization_roles force row level security;

create policy organization_roles_select_member
  on public.organization_roles
  for select
  to authenticated
  using ((select public.is_organization_member(org_id)));

revoke all on function public.protect_owner_organization_role()
  from public, anon, authenticated;
revoke all on function public.seed_organization_roles()
  from public, anon, authenticated;
revoke all on function public.sync_membership_role_definition()
  from public, anon, authenticated;
revoke all on function public.sync_invite_role_definition()
  from public, anon, authenticated;
revoke all on function public.update_organization_member_access(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.archive_organization_role(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_current_organization_context(uuid)
  from public, anon, authenticated;

grant execute on function public.update_organization_member_access(
  uuid, uuid, uuid, uuid, text
) to service_role;
grant execute on function public.archive_organization_role(uuid, uuid, uuid)
  to service_role;
grant execute on function public.get_current_organization_context(uuid)
  to service_role;

notify pgrst, 'reload schema';
