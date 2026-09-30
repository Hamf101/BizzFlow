-- A template can be shared, and kept to the people it is shared with.
--
-- Until now a template was open to every member who may view templates and
-- editable only by those who may manage them. Three things change.
--
-- 1. Sharing. A template can be shared with a person or a role at one of three
--    levels: view it, use it (make documents and forms from it), or edit it.
--    Sharing adds to what a role already gives.
-- 2. Restriction. A template with access_restricted = true drops the open
--    baseline, so only the person who made it, owner admins, and the people and
--    roles it is shared with can open it. Not restricted, it works as before.
-- 3. Making. Members can make templates of their own with the new
--    templates:create permission (given to managers and staff), and always edit
--    what they made. Editing someone else's needs the manage permission or to
--    be shared with as an editor.
--
-- The grant table follows document_access_grants: closed to signed-in users,
-- read and written by the service role only. Signed-in users hold no read on
-- document_templates today either; the published-member policy is kept in step
-- anyway, so that restoring that read could never expose a restricted template.

alter table public.organization_roles
  drop constraint organization_roles_permissions_supported;

alter table public.organization_roles
  add constraint organization_roles_permissions_supported
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
        'templates:create',
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
    );

-- Managers and staff gain the new permission; roles a workspace made itself
-- keep exactly what they have.
update public.organization_roles
set permissions = array_append(permissions, 'templates:create')
where system_key in ('manager', 'staff')
  and permissions is not null
  and not 'templates:create' = any (permissions);

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
        'templates:view', 'templates:create', 'templates:manage', 'documents:view',
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
        'people:view', 'templates:view', 'templates:create', 'documents:view',
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

create type public.template_access_level as enum ('viewer', 'user', 'editor');

alter table public.document_templates
  add column access_restricted boolean not null default false;

comment on column public.document_templates.access_restricted is
  'When true, only the maker, owner admins and the people and roles in template_access_grants can open the template.';

create table public.template_access_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  template_id uuid not null,
  user_id uuid,
  organization_role public.organization_role,
  access_level public.template_access_level not null,
  granted_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  constraint template_access_grants_template_org_fkey
    foreign key (template_id, org_id)
    references public.document_templates (id, org_id)
    on delete cascade,
  constraint template_access_grants_user_membership_fkey
    foreign key (org_id, user_id)
    references public.organization_memberships (org_id, user_id)
    on delete cascade,
  constraint template_access_grants_granted_by_membership_fkey
    foreign key (org_id, granted_by)
    references public.organization_memberships (org_id, user_id)
    on delete set null (granted_by),
  constraint template_access_grants_exactly_one_principal
    check (num_nonnulls(user_id, organization_role) = 1),
  constraint template_access_grants_external_reviewer_viewer_only
    check (
      organization_role is distinct from 'external_reviewer'
      or access_level = 'viewer'
    )
);

create unique index template_access_grants_user_unique_idx
  on public.template_access_grants (org_id, template_id, user_id)
  where user_id is not null;

create unique index template_access_grants_role_unique_idx
  on public.template_access_grants (org_id, template_id, organization_role)
  where organization_role is not null;

create index template_access_grants_org_resource_idx
  on public.template_access_grants (org_id, template_id);

create index template_access_grants_user_fk_idx
  on public.template_access_grants (org_id, user_id)
  where user_id is not null;

create index template_access_grants_granted_by_fk_idx
  on public.template_access_grants (org_id, granted_by)
  where granted_by is not null;

create trigger template_access_grants_set_updated_at
  before update on public.template_access_grants
  for each row execute function public.set_updated_at();

alter table public.template_access_grants enable row level security;
alter table public.template_access_grants force row level security;

revoke all on table public.template_access_grants
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.template_access_grants
  to service_role;

-- What one member may do with one template: null for nothing, otherwise
-- viewer, user or editor. Owner admins and the person who made it are editors;
-- shared access adds to that; and a template that is not restricted also gives
-- what the role does (manage is editor, view is user). External reviewers
-- never go above viewer.
create function private.effective_template_access_level(
  target_org_id uuid,
  target_template_id uuid,
  target_actor_user_id uuid
)
returns public.template_access_level
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role public.organization_role;
  template_creator uuid;
  template_restricted boolean;
  access_rank integer := 0;
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

  select template.created_by, template.access_restricted
  into template_creator, template_restricted
  from public.document_templates template
  where template.id = target_template_id
    and template.org_id = target_org_id;

  if not found then
    return null;
  end if;

  if actor_role = 'owner_admin' then
    return 'editor'::public.template_access_level;
  end if;

  if template_creator = target_actor_user_id then
    access_rank := 3;
  end if;

  select greatest(
    access_rank,
    coalesce(max(
      case grant_row.access_level
        when 'editor' then 3
        when 'user' then 2
        else 1
      end
    ), 0)
  )
  into access_rank
  from public.template_access_grants grant_row
  where grant_row.org_id = target_org_id
    and grant_row.template_id = target_template_id
    and (
      grant_row.user_id = target_actor_user_id
      or grant_row.organization_role = actor_role
    );

  if not template_restricted then
    if private.member_can(target_org_id, target_actor_user_id, 'templates:manage') then
      access_rank := greatest(access_rank, 3);
    elsif private.member_can(target_org_id, target_actor_user_id, 'templates:view') then
      access_rank := greatest(access_rank, 2);
    end if;
  end if;

  if access_rank = 0 then
    return null;
  end if;

  if actor_role = 'external_reviewer' then
    return 'viewer'::public.template_access_level;
  end if;

  return case access_rank
    when 3 then 'editor'
    when 2 then 'user'
    else 'viewer'
  end::public.template_access_level;
end;
$$;

revoke all on function private.effective_template_access_level(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.effective_template_access_level(uuid, uuid, uuid)
  to service_role;

-- The three questions the app asks. The service role calls these; the private
-- function above stays closed.
create function public.get_template_access_level(
  target_org_id uuid,
  target_template_id uuid,
  target_actor_user_id uuid
)
returns public.template_access_level
language sql
stable
security invoker
set search_path = ''
as $$
  select private.effective_template_access_level(
    target_org_id,
    target_template_id,
    target_actor_user_id
  );
$$;

-- Templates to leave out of this member's list: restricted ones they cannot
-- open, and unpublished ones they may look at or use but not edit, since only
-- editors see a draft.
create function public.hidden_template_ids(
  target_org_id uuid,
  target_actor_user_id uuid
)
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select hidden.id
  from (
    select
      template.id,
      template.status,
      private.effective_template_access_level(
        target_org_id,
        template.id,
        target_actor_user_id
      ) as level
    from public.document_templates template
    where template.org_id = target_org_id
      and (template.access_restricted or template.status <> 'published')
  ) hidden
  where hidden.level is null
    or (hidden.status <> 'published' and hidden.level <> 'editor'::public.template_access_level);
$$;

-- Templates this member may edit, in any status: what they made, what they were
-- shared with as an editor, and everything, for those who manage templates.
create function public.editable_template_ids(
  target_org_id uuid,
  target_actor_user_id uuid
)
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select template.id
  from public.document_templates template
  where template.org_id = target_org_id
    and private.effective_template_access_level(
      target_org_id,
      template.id,
      target_actor_user_id
    ) = 'editor'::public.template_access_level;
$$;

revoke all on function public.get_template_access_level(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.hidden_template_ids(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.editable_template_ids(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_template_access_level(uuid, uuid, uuid)
  to service_role;
grant execute on function public.hidden_template_ids(uuid, uuid)
  to service_role;
grant execute on function public.editable_template_ids(uuid, uuid)
  to service_role;

-- A template's working copy is edited by its editors, which now includes the
-- person who made it and anyone it was shared with as an editor.
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
    return private.effective_template_access_level(room.org_id, room.template_id, actor_user_id)
      = 'editor'::public.template_access_level;
  end if;

  return private.member_can(room.org_id, actor_user_id, 'documents:fill')
    and private.effective_document_access_level(room.org_id, room.document_id, actor_user_id)
      = 'contributor'::public.resource_access_level;
end;
$$;

drop policy if exists document_templates_select_published_member
  on public.document_templates;

create policy document_templates_select_published_member
  on public.document_templates
  for select
  to authenticated
  using (
    status = 'published'
    and not access_restricted
    and (select public.organization_role_for(org_id)) in (
      'owner_admin',
      'manager',
      'staff'
    )
  );

notify pgrst, 'reload schema';
