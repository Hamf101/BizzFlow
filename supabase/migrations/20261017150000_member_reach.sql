-- What the hierarchy means for work: one answer per member for every list.
--   everyone    their reach is the whole workspace (owners; an everyone role;
--               a branch role not yet placed anywhere)
--   visible     who they see, as visible_member_ids (null when everyone)
--   supervised  their direct reports and everyone in the teams they lead,
--               and in the teams beneath those: whose work a lead or manager
--               looks over even where their role keeps work to its author.
-- The scope is worked out once, in private.member_scope, for both functions.

create or replace function private.member_scope(target_org_id uuid, target_user_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  scope text;
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
    return 'everyone';
  end if;

  return scope;
end;
$$;

create or replace function private.supervised_member_ids(target_org_id uuid, target_user_id uuid)
returns setof uuid
language sql
stable
set search_path = ''
as $$
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
  )
  select membership.user_id
  from public.organization_memberships membership
  where membership.org_id = target_org_id
    and membership.status = 'active'
    and membership.user_id <> target_user_id
    and (
      membership.manager_user_id = target_user_id
      or membership.user_id in (
        select teammate.user_id
        from public.org_unit_members teammate
        where teammate.org_id = target_org_id and teammate.unit_id in (select led.unit_id from led)
      )
    );
$$;

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
  scope text := private.member_scope(target_org_id, target_user_id);
  inviter uuid;
begin
  if scope is null then
    return;
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
            join public.org_unit_members teammate on teammate.unit_id = inviter_unit.unit_id
            where inviter_unit.org_id = target_org_id and inviter_unit.user_id = inviter
          )
        );
    return;
  end if;

  -- branch: themselves, their manager, their teams, and everyone they supervise.
  return query
    select distinct membership.user_id
    from public.organization_memberships membership
    where membership.org_id = target_org_id
      and membership.status = 'active'
      and (
        membership.user_id = target_user_id
        or membership.user_id = (
          select viewer.manager_user_id
          from public.organization_memberships viewer
          where viewer.org_id = target_org_id and viewer.user_id = target_user_id
        )
        or membership.user_id in (
          select teammate.user_id
          from public.org_unit_members mine
          join public.org_unit_members teammate on teammate.unit_id = mine.unit_id
          where mine.org_id = target_org_id and mine.user_id = target_user_id
        )
        or membership.user_id in (select private.supervised_member_ids(target_org_id, target_user_id))
      );
end;
$$;

create or replace function public.member_reach(target_org_id uuid, target_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'everyone', private.member_scope(target_org_id, target_user_id) = 'everyone',
    'visible',
      case
        when private.member_scope(target_org_id, target_user_id) = 'everyone' then null
        else coalesce((select jsonb_agg(id) from public.visible_member_ids(target_org_id, target_user_id) id), '[]'::jsonb)
      end,
    'supervised', coalesce((select jsonb_agg(id) from private.supervised_member_ids(target_org_id, target_user_id) id), '[]'::jsonb)
  );
$$;

revoke all on function private.member_scope(uuid, uuid) from public, anon, authenticated;
revoke all on function private.supervised_member_ids(uuid, uuid) from public, anon, authenticated;
revoke all on function public.member_reach(uuid, uuid) from public, anon, authenticated;
grant execute on function public.member_reach(uuid, uuid) to service_role;
grant execute on function private.member_scope(uuid, uuid) to service_role;
grant execute on function private.supervised_member_ids(uuid, uuid) to service_role;
