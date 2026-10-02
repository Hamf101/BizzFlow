-- Exercises template sharing against a real database: what each member may do
-- with a template that is open, restricted, or shared, the grant table's own
-- rules, and that a signed-in member reaches templates only through the service. Creates isolated synthetic rows inside one statement and
-- removes them before returning; any failed check rolls everything back.
do $$
<<template_sharing_test>>
declare
  owner_id uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  maker_id uuid := gen_random_uuid();
  staff_id uuid := gen_random_uuid();
  reviewer_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  open_template uuid := gen_random_uuid();
  closed_template uuid := gen_random_uuid();
  shared_template uuid := gen_random_uuid();
  blank constant jsonb := '{"schemaVersion":3,"branding":{},"blocks":[],"layout":{},"sections":[],"fieldGroups":[],"blockRules":[]}';
  expectation record;
  refused boolean;
begin
  insert into auth.users (id, email, created_at, updated_at)
  select member.id, 'tpl-' || replace(member.id::text, '-', '') || '@example.invalid', now(), now()
  from unnest(array[owner_id, manager_id, maker_id, staff_id, reviewer_id]) as member(id);

  insert into public.profiles (id, email, full_name)
  select member.id, 'tpl-' || replace(member.id::text, '-', '') || '@example.invalid', 'Template sharing verification'
  from unnest(array[owner_id, manager_id, maker_id, staff_id, reviewer_id]) as member(id);

  insert into public.organizations (id, name, slug, created_by)
  values (organization_id, 'Template sharing verification', 'tpl-' || replace(organization_id::text, '-', ''), owner_id);

  insert into public.organization_memberships (org_id, user_id, role, status)
  select organization_id, owner_id, 'owner_admin', 'active'
  where not exists (
    select 1 from public.organization_memberships membership
    where membership.org_id = organization_id and membership.user_id = owner_id
  );

  insert into public.organization_memberships (org_id, user_id, role, status)
  values
    (organization_id, manager_id, 'manager', 'active'),
    (organization_id, maker_id, 'staff', 'active'),
    (organization_id, staff_id, 'staff', 'active'),
    (organization_id, reviewer_id, 'external_reviewer', 'active');

  -- The new permission reached the roles a workspace starts with.
  if not exists (
    select 1 from public.organization_roles role
    where role.org_id = organization_id and role.system_key = 'staff' and 'templates:create' = any (role.permissions)
  ) then
    raise exception 'Staff did not get templates:create.';
  end if;

  -- Made by maker_id. open: not restricted. closed: restricted, shared with nobody.
  -- shared: restricted, shared with staff as user and with the manager role as viewer.
  insert into public.document_templates (id, org_id, title, status, revision, content, created_by, updated_by, published_by, published_at, access_restricted)
  values
    (open_template, organization_id, 'Open', 'published', 1, blank, maker_id, maker_id, maker_id, now(), false),
    (closed_template, organization_id, 'Closed', 'published', 1, blank, maker_id, maker_id, maker_id, now(), true),
    (shared_template, organization_id, 'Shared', 'published', 1, blank, maker_id, maker_id, maker_id, now(), true);

  insert into public.template_access_grants (org_id, template_id, user_id, organization_role, access_level)
  values
    (organization_id, shared_template, staff_id, null, 'user'),
    (organization_id, shared_template, null, 'manager', 'viewer');

  -- who, template, expected level (null: none)
  for expectation in
    select * from (values
      (owner_id, open_template, 'editor'), (owner_id, closed_template, 'editor'),
      (manager_id, open_template, 'editor'), (manager_id, closed_template, null), (manager_id, shared_template, 'viewer'),
      (maker_id, open_template, 'editor'), (maker_id, closed_template, 'editor'), (maker_id, shared_template, 'editor'),
      (staff_id, open_template, 'user'), (staff_id, closed_template, null), (staff_id, shared_template, 'user'),
      (reviewer_id, open_template, null), (reviewer_id, closed_template, null), (reviewer_id, shared_template, null)
    ) as cases(actor, template, expected)
  loop
    if private.effective_template_access_level(organization_id, expectation.template, expectation.actor)::text
        is distinct from expectation.expected then
      raise exception 'Member % on template % should have %, has %.',
        expectation.actor, expectation.template, expectation.expected,
        private.effective_template_access_level(organization_id, expectation.template, expectation.actor);
    end if;
  end loop;

  -- The lists the app leaves out and draws in agree with the single answers.
  if (select array_agg(id order by id) from public.hidden_template_ids(organization_id, staff_id) as id)
      is distinct from array[closed_template] then
    raise exception 'Staff should not see exactly the closed template hidden.';
  end if;
  -- A draft shared to view or use stays out of sight until it is published; its editors always see it.
  update public.document_templates set status = 'draft', published_at = null, published_by = null where id = shared_template;
  if (select array_agg(id order by id) from public.hidden_template_ids(organization_id, staff_id) as id)
      is distinct from (select array_agg(t order by t) from unnest(array[closed_template, shared_template]) as t) then
    raise exception 'A draft shared to use was not hidden from the person using it.';
  end if;
  if exists (select 1 from public.hidden_template_ids(organization_id, maker_id) as id) then
    raise exception 'The maker had their own draft hidden.';
  end if;
  update public.document_templates set status = 'published', published_at = now(), published_by = maker_id where id = shared_template;

  if (select count(*) from public.hidden_template_ids(organization_id, owner_id)) <> 0 then
    raise exception 'An owner admin had templates hidden.';
  end if;
  if (select array_agg(id order by id) from public.editable_template_ids(organization_id, maker_id) as id)
      is distinct from (select array_agg(t order by t) from unnest(array[open_template, closed_template, shared_template]) as t) then
    raise exception 'The maker should be able to edit all three.';
  end if;
  if public.get_template_access_level(organization_id, shared_template, staff_id) is distinct from 'user' then
    raise exception 'The wrapper disagrees with the function.';
  end if;

  -- Sharing adds to a role's baseline: an editor grant lets staff edit an open template, and lets the reviewer view.
  insert into public.template_access_grants (org_id, template_id, user_id, organization_role, access_level)
  values (organization_id, open_template, staff_id, null, 'editor');
  if private.effective_template_access_level(organization_id, open_template, staff_id) is distinct from 'editor' then
    raise exception 'A grant did not lift staff on an open template.';
  end if;

  insert into public.template_access_grants (org_id, template_id, user_id, organization_role, access_level)
  values (organization_id, shared_template, reviewer_id, null, 'viewer');
  if private.effective_template_access_level(organization_id, shared_template, reviewer_id) is distinct from 'viewer' then
    raise exception 'A viewer grant did not let the reviewer view.';
  end if;

  -- The table's own rules.
  refused := false;
  begin
    insert into public.template_access_grants (org_id, template_id, organization_role, access_level)
    values (organization_id, closed_template, 'external_reviewer', 'user');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'A reviewer role was given more than view.'; end if;

  refused := false;
  begin
    insert into public.template_access_grants (org_id, template_id, access_level)
    values (organization_id, closed_template, 'viewer');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'A grant with nobody in it was accepted.'; end if;

  refused := false;
  begin
    insert into public.template_access_grants (org_id, template_id, user_id, access_level)
    values (organization_id, shared_template, staff_id, 'viewer');
  exception when unique_violation then refused := true;
  end;
  if not refused then raise exception 'A person was granted the same template twice.'; end if;

  -- A signed-in member reaches neither templates nor grants directly; the service is the only way in.
  perform set_config('request.jwt.claims', json_build_object('sub', staff_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  refused := false;
  begin
    perform count(*) from public.document_templates;
  exception when insufficient_privilege then refused := true;
  end;
  reset role;
  if not refused then raise exception 'A member could read templates directly.'; end if;

  set local role authenticated;
  refused := false;
  begin
    perform count(*) from public.template_access_grants;
  exception when insufficient_privilege then refused := true;
  end;
  reset role;
  if not refused then raise exception 'A member could read the grant table.'; end if;

  perform set_config('request.jwt.claims', null, true);

  -- Removing a template removes its grants.
  delete from public.document_templates where id = shared_template;
  if exists (select 1 from public.template_access_grants where template_id = shared_template) then
    raise exception 'Grants outlived their template.';
  end if;

  delete from public.organizations where id = organization_id;
  delete from auth.users where id in (owner_id, manager_id, maker_id, staff_id, reviewer_id);
end;
$$;
