-- The workspace's shape beneath its roles: teams nested to any depth (a
-- department, its teams, their crews), who belongs to which (several at once,
-- some as leads), who reports to whom, and per role how far someone sees.
--
-- A role's visibility_scope:
--   everyone  every active member (owners, always)
--   branch    themselves, their manager, their direct reports, everyone in
--             their teams, and, as a team's lead, everyone in the teams under
--             it. Someone not yet placed in a team or a reporting line still
--             sees everyone, so a workspace that sets up no structure keeps
--             working as it did.
--   inviter   themselves, whoever invited them, and everyone in that
--             person's teams: an outside reviewer sees the side of the
--             business that brought them in.
-- Null means the role's default: inviter for external reviewers, branch for
-- staff, everyone otherwise; custom roles default to everyone.
--
-- Closed like the other membership tables: no signed-in or anonymous
-- privileges, reached only through the service layer.

create table public.org_units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  parent_id uuid,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  constraint org_units_parent_fkey
    foreign key (org_id, parent_id) references public.org_units (org_id, id) on delete cascade,
  constraint org_units_name_length check (name = btrim(name) and char_length(name) between 1 and 80),
  constraint org_units_not_own_parent check (parent_id is distinct from id)
);

create index org_units_org_parent_idx on public.org_units (org_id, parent_id);

create table public.org_unit_members (
  org_id uuid not null,
  unit_id uuid not null,
  user_id uuid not null,
  is_lead boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (unit_id, user_id),
  constraint org_unit_members_unit_fkey
    foreign key (org_id, unit_id) references public.org_units (org_id, id) on delete cascade,
  constraint org_unit_members_member_fkey
    foreign key (org_id, user_id) references public.organization_memberships (org_id, user_id) on delete cascade
);

create index org_unit_members_org_user_idx on public.org_unit_members (org_id, user_id);

alter table public.organization_memberships
  add column manager_user_id uuid,
  add constraint organization_memberships_manager_fkey
    foreign key (org_id, manager_user_id)
    references public.organization_memberships (org_id, user_id)
    on delete set null (manager_user_id),
  add constraint organization_memberships_not_own_manager
    check (manager_user_id is distinct from user_id);

create index organization_memberships_manager_idx
  on public.organization_memberships (org_id, manager_user_id)
  where manager_user_id is not null;

alter table public.organization_roles
  add column visibility_scope text,
  add constraint organization_roles_visibility_scope_check
    check (visibility_scope is null or visibility_scope in ('everyone', 'branch', 'inviter'));

-- Neither tree may loop: a team under its own descendant, or a manager who
-- (through others) reports to the person they manage.
create or replace function private.refuse_org_unit_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and exists (
    with recursive ancestors as (
      select unit.id, unit.parent_id, 1 as depth
      from public.org_units unit
      where unit.id = new.parent_id and unit.org_id = new.org_id
      union all
      select parent.id, parent.parent_id, ancestors.depth + 1
      from ancestors
      join public.org_units parent on parent.id = ancestors.parent_id and parent.org_id = new.org_id
      where ancestors.depth < 64
    )
    select 1 from ancestors where ancestors.id = new.id
  ) then
    raise exception 'A team cannot sit inside itself.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger org_units_refuse_cycle
  before insert or update of parent_id on public.org_units
  for each row execute function private.refuse_org_unit_cycle();

create or replace function private.refuse_manager_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.manager_user_id is not null and exists (
    with recursive chain as (
      select membership.user_id, membership.manager_user_id, 1 as depth
      from public.organization_memberships membership
      where membership.org_id = new.org_id and membership.user_id = new.manager_user_id
      union all
      select above.user_id, above.manager_user_id, chain.depth + 1
      from chain
      join public.organization_memberships above
        on above.org_id = new.org_id and above.user_id = chain.manager_user_id
      where chain.depth < 64
    )
    select 1 from chain where chain.user_id = new.user_id
  ) then
    raise exception 'Someone cannot report to a person who reports to them.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger organization_memberships_refuse_manager_cycle
  before insert or update of manager_user_id on public.organization_memberships
  for each row execute function private.refuse_manager_cycle();

-- Who a member may see, by the scope of their role. Inactive members are
-- never returned; the viewer always sees themselves.
create or replace function public.visible_member_ids(
  target_org_id uuid,
  target_user_id uuid
)
returns setof uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  scope text;
  inviter uuid;
begin
  select
    case
      when role.system_key = 'owner_admin' then 'everyone'
      else coalesce(
        role.visibility_scope,
        case role.system_key
          when 'external_reviewer' then 'inviter'
          when 'staff' then 'branch'
          else 'everyone'
        end
      )
    end
  into scope
  from public.organization_memberships membership
  join public.organization_roles role
    on role.org_id = membership.org_id and role.id = membership.role_definition_id
  where membership.org_id = target_org_id
    and membership.user_id = target_user_id
    and membership.status = 'active';

  if scope is null then
    return;
  end if;

  if scope = 'branch' and not exists (
    select 1 from public.org_unit_members unit_member
    where unit_member.org_id = target_org_id and unit_member.user_id = target_user_id
  ) and not exists (
    select 1 from public.organization_memberships membership
    where membership.org_id = target_org_id
      and (
        (membership.user_id = target_user_id and membership.manager_user_id is not null)
        or membership.manager_user_id = target_user_id
      )
  ) then
    scope := 'everyone';
  end if;

  if scope = 'everyone' then
    return query
      select membership.user_id
      from public.organization_memberships membership
      where membership.org_id = target_org_id and membership.status = 'active';
    return;
  end if;

  if scope = 'inviter' then
    select invite.invited_by into inviter
    from public.invites invite
    where invite.org_id = target_org_id
      and invite.accepted_by = target_user_id
      and invite.status = 'accepted'
    order by invite.accepted_at desc nulls last
    limit 1;

    return query
      select distinct membership.user_id
      from public.organization_memberships membership
      where membership.org_id = target_org_id
        and membership.status = 'active'
        and (
          membership.user_id = target_user_id
          or membership.user_id = inviter
          or membership.user_id in (
            select teammate.user_id
            from public.org_unit_members inviter_unit
            join public.org_unit_members teammate
              on teammate.unit_id = inviter_unit.unit_id
            where inviter_unit.org_id = target_org_id and inviter_unit.user_id = inviter
          )
        );
    return;
  end if;

  -- branch
  return query
    with recursive led as (
      select unit_member.unit_id
      from public.org_unit_members unit_member
      where unit_member.org_id = target_org_id
        and unit_member.user_id = target_user_id
        and unit_member.is_lead
      union
      select child.id
      from led
      join public.org_units child on child.org_id = target_org_id and child.parent_id = led.unit_id
    ),
    mine as (
      select unit_member.unit_id
      from public.org_unit_members unit_member
      where unit_member.org_id = target_org_id and unit_member.user_id = target_user_id
      union
      select led.unit_id from led
    )
    select distinct membership.user_id
    from public.organization_memberships membership
    where membership.org_id = target_org_id
      and membership.status = 'active'
      and (
        membership.user_id = target_user_id
        or membership.manager_user_id = target_user_id
        or membership.user_id = (
          select viewer.manager_user_id
          from public.organization_memberships viewer
          where viewer.org_id = target_org_id and viewer.user_id = target_user_id
        )
        or membership.user_id in (
          select teammate.user_id
          from public.org_unit_members teammate
          where teammate.org_id = target_org_id
            and teammate.unit_id in (select mine.unit_id from mine)
        )
      );
end;
$$;

alter table public.org_units enable row level security;
alter table public.org_units force row level security;
alter table public.org_unit_members enable row level security;
alter table public.org_unit_members force row level security;

revoke all on table public.org_units from public, anon, authenticated, service_role;
revoke all on table public.org_unit_members from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.org_units to service_role;
grant select, insert, update, delete on table public.org_unit_members to service_role;

revoke all on function public.visible_member_ids(uuid, uuid) from public, anon, authenticated;
grant execute on function public.visible_member_ids(uuid, uuid) to service_role;
revoke all on function private.refuse_org_unit_cycle() from public, anon, authenticated;
revoke all on function private.refuse_manager_cycle() from public, anon, authenticated;

create trigger org_units_set_updated_at
  before update on public.org_units
  for each row execute function public.set_updated_at();
