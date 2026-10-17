-- Who a member sees follows their role's scope and where they sit:
--   Ops (led by Lee)  ├ Crew 1: Avery, Ash   └ Crew 2: Blair
--   Avery reports to Morgan (a manager); Casey (staff) is placed nowhere.
--   Erin (outside reviewer) was invited by Avery.
-- Owners and managers see everyone; staff see their branch; a lead sees the
-- teams beneath theirs; someone placed nowhere still sees everyone; an outside
-- reviewer sees their inviter and the inviter's teams. Neither tree may loop.
-- Creates isolated synthetic rows inside one statement; any failed check rolls
-- everything back.
do $$
<<hierarchy_test>>
declare
  org uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid();
  morgan uuid := gen_random_uuid();
  lee uuid := gen_random_uuid();
  avery uuid := gen_random_uuid();
  ash uuid := gen_random_uuid();
  blair uuid := gen_random_uuid();
  casey uuid := gen_random_uuid();
  erin uuid := gen_random_uuid();
  gone uuid := gen_random_uuid();
  ops uuid := gen_random_uuid();
  crew1 uuid := gen_random_uuid();
  crew2 uuid := gen_random_uuid();
  person uuid;
  seen uuid[];
begin
  foreach person in array array[owner_id, morgan, lee, avery, ash, blair, casey, erin, gone] loop
    insert into auth.users (id, email, created_at, updated_at)
    values (person, 'h-' || replace(person::text, '-', '') || '@example.invalid', now(), now());
    insert into public.profiles (id, email, full_name)
    values (person, 'h-' || replace(person::text, '-', '') || '@example.invalid', 'Hierarchy verification');
  end loop;

  insert into public.organizations (id, name, slug, created_by)
  values (org, 'Hierarchy verification', 'hierarchy-' || replace(org::text, '-', ''), owner_id);

  insert into public.organization_memberships (org_id, user_id, role, status)
  values
    (org, owner_id, 'owner_admin', 'active'),
    (org, morgan, 'manager', 'active'),
    (org, lee, 'staff', 'active'),
    (org, avery, 'staff', 'active'),
    (org, ash, 'staff', 'active'),
    (org, blair, 'staff', 'active'),
    (org, casey, 'staff', 'active'),
    (org, erin, 'external_reviewer', 'active'),
    (org, gone, 'staff', 'disabled');

  insert into public.invites (org_id, email, role, token_hash, invited_by, status, accepted_by, accepted_at)
  values (org, 'erin-' || replace(erin::text, '-', '') || '@example.invalid', 'external_reviewer', encode(sha256(erin::text::bytea), 'hex'), avery, 'accepted', erin, now());

  insert into public.org_units (id, org_id, parent_id, name)
  values (ops, org, null, 'Ops'), (crew1, org, ops, 'Crew 1'), (crew2, org, ops, 'Crew 2');

  insert into public.org_unit_members (org_id, unit_id, user_id, is_lead)
  values
    (org, ops, lee, true),
    (org, crew1, avery, false),
    (org, crew1, ash, false),
    (org, crew1, gone, false),
    (org, crew2, blair, false);

  update public.organization_memberships set manager_user_id = morgan
  where org_id = org and user_id = avery;

  -- Owners and managers see everyone active.
  select array_agg(id order by id) into seen from public.visible_member_ids(org, morgan) id;
  if seen <> (select array_agg(id order by id) from unnest(array[owner_id, morgan, lee, avery, ash, blair, casey, erin]) id) then
    raise exception 'A manager did not see every active member.';
  end if;

  -- Avery: themselves, their manager, their crew; not the other crew or Casey.
  select array_agg(id order by id) into seen from public.visible_member_ids(org, avery) id;
  if seen <> (select array_agg(id order by id) from unnest(array[avery, morgan, ash]) id) then
    raise exception 'Staff did not see exactly their branch: %', seen;
  end if;

  -- Lee leads Ops, so sees both crews beneath it.
  select array_agg(id order by id) into seen from public.visible_member_ids(org, lee) id;
  if seen <> (select array_agg(id order by id) from unnest(array[lee, avery, ash, blair]) id) then
    raise exception 'A lead did not see the teams under theirs: %', seen;
  end if;

  -- Casey is placed nowhere, so still sees everyone.
  if (select count(*) from public.visible_member_ids(org, casey)) <> 8 then
    raise exception 'Someone placed nowhere lost sight of the workspace.';
  end if;

  -- Erin sees Avery, who invited them, and Avery's crew.
  select array_agg(id order by id) into seen from public.visible_member_ids(org, erin) id;
  if seen <> (select array_agg(id order by id) from unnest(array[erin, avery, ash]) id) then
    raise exception 'An outside reviewer did not see exactly their inviter''s side: %', seen;
  end if;

  -- For work: who each looks over, and whether their reach is everything.
  if (public.member_reach(org, lee) -> 'everyone')::boolean
      or (select array_agg(value::uuid order by value::uuid) from jsonb_array_elements_text(public.member_reach(org, lee) -> 'supervised'))
        <> (select array_agg(id order by id) from unnest(array[avery, ash, blair]) id)
      or (select array_agg(value::uuid) from jsonb_array_elements_text(public.member_reach(org, morgan) -> 'supervised')) <> array[avery]
      or jsonb_array_length(public.member_reach(org, avery) -> 'supervised') <> 0
      or not (public.member_reach(org, morgan) -> 'everyone')::boolean
      or public.member_reach(org, morgan) -> 'visible' <> 'null'::jsonb
      or not (public.member_reach(org, casey) -> 'everyone')::boolean then
    raise exception 'member_reach did not say who each looks over: %', public.member_reach(org, lee);
  end if;

  -- A role set to everyone widens it; an inactive viewer sees nobody.
  update public.organization_roles set visibility_scope = 'everyone'
  where org_id = org and system_key = 'staff';
  if (select count(*) from public.visible_member_ids(org, avery)) <> 8 then
    raise exception 'A role widened to everyone did not widen what staff see.';
  end if;
  if exists (select 1 from public.visible_member_ids(org, gone)) then
    raise exception 'A disabled member could see anyone.';
  end if;

  -- Neither tree loops.
  begin
    update public.org_units set parent_id = crew1 where id = ops;
    raise exception 'A team was put inside its own sub-team.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;

  update public.organization_memberships set manager_user_id = avery
  where org_id = org and user_id = ash;
  begin
    update public.organization_memberships set manager_user_id = ash
    where org_id = org and user_id = morgan;
    update public.organization_memberships set manager_user_id = morgan
    where org_id = org and user_id = avery;
    raise exception 'A reporting line was allowed to loop.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;
end;
$$;
