-- Exercises get_folder_access_levels and get_document_access_levels against a
-- real database: for owners, managers, staff, reviewers, and outsiders, each
-- bulk answer matches the single-item answer, ids without access come back as
-- null, and an oversized call is refused. Creates isolated synthetic rows
-- inside one statement and removes them before returning; any failed check
-- rolls everything back.
do $$
<<access_levels_test>>
declare
  owner_id uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  staff_id uuid := gen_random_uuid();
  reviewer_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  shared_folder_id uuid := gen_random_uuid();
  nested_folder_id uuid := gen_random_uuid();
  private_folder_id uuid := gen_random_uuid();
  nested_document_id uuid := gen_random_uuid();
  granted_document_id uuid := gen_random_uuid();
  staff_document_id uuid := gen_random_uuid();
  folder_ids uuid[];
  document_ids uuid[];
  actor uuid;
  mismatches integer;
begin
  insert into auth.users (id, email, created_at, updated_at)
  select
    member.id,
    'rpc-' || replace(member.id::text, '-', '') || '@example.invalid',
    now(),
    now()
  from unnest(
    array[owner_id, manager_id, staff_id, reviewer_id, outsider_id]
  ) as member(id);

  insert into public.profiles (id, email, full_name)
  select
    member.id,
    'rpc-' || replace(member.id::text, '-', '') || '@example.invalid',
    'Access levels verification'
  from unnest(
    array[owner_id, manager_id, staff_id, reviewer_id, outsider_id]
  ) as member(id);

  insert into public.organizations (id, name, slug, created_by)
  values (
    organization_id,
    'Access levels verification',
    'access-rpc-' || replace(organization_id::text, '-', ''),
    owner_id
  );

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.org_id = organization_id
      and membership.user_id = owner_id
  ) then
    insert into public.organization_memberships (org_id, user_id, role, status)
    values (organization_id, owner_id, 'owner_admin', 'active');
  end if;

  insert into public.organization_memberships (org_id, user_id, role, status)
  values
    (organization_id, manager_id, 'manager', 'active'),
    (organization_id, staff_id, 'staff', 'active'),
    (organization_id, reviewer_id, 'external_reviewer', 'active');

  insert into public.folders (id, org_id, parent_folder_id, name, created_by, updated_by)
  values
    (shared_folder_id, organization_id, null, 'Shared', owner_id, owner_id),
    (private_folder_id, organization_id, null, 'Private', owner_id, owner_id);

  insert into public.folders (id, org_id, parent_folder_id, name, created_by, updated_by)
  values (nested_folder_id, organization_id, shared_folder_id, 'Nested', owner_id, owner_id);

  insert into public.documents (id, org_id, folder_id, title, created_by, updated_by)
  values
    (nested_document_id, organization_id, nested_folder_id, 'Nested document', owner_id, owner_id),
    (granted_document_id, organization_id, private_folder_id, 'Granted document', owner_id, owner_id),
    (staff_document_id, organization_id, null, 'Staff document', staff_id, staff_id);

  insert into public.folder_access_grants (org_id, folder_id, user_id, organization_role, access_level, granted_by)
  values
    (organization_id, shared_folder_id, staff_id, null, 'viewer', owner_id),
    (organization_id, private_folder_id, null, 'manager', 'contributor', owner_id);

  insert into public.document_access_grants (org_id, document_id, user_id, organization_role, access_level, granted_by)
  values (organization_id, granted_document_id, reviewer_id, null, 'viewer', owner_id);

  -- One id nobody can reach rides along in each call.
  folder_ids := array[shared_folder_id, nested_folder_id, private_folder_id, gen_random_uuid()];
  document_ids := array[nested_document_id, granted_document_id, staff_document_id, gen_random_uuid()];

  foreach actor in array array[owner_id, manager_id, staff_id, reviewer_id, outsider_id] loop
    select count(*)
    into mismatches
    from public.get_folder_access_levels(organization_id, folder_ids, actor) bulk
    where bulk.access_level is distinct from
      public.get_folder_access_level(organization_id, bulk.folder_id, actor);

    if mismatches <> 0
      or (select count(*) from public.get_folder_access_levels(organization_id, folder_ids, actor)) <> 4 then
      raise exception 'Bulk folder access disagrees with the single lookup for %.', actor;
    end if;

    select count(*)
    into mismatches
    from public.get_document_access_levels(organization_id, document_ids, actor) bulk
    where bulk.access_level is distinct from
      public.get_document_access_level(organization_id, bulk.document_id, actor);

    if mismatches <> 0
      or (select count(*) from public.get_document_access_levels(organization_id, document_ids, actor)) <> 4 then
      raise exception 'Bulk document access disagrees with the single lookup for %.', actor;
    end if;
  end loop;

  -- The agreement above is not vacuous: each rule shows up in the answers.
  if (select count(*) from public.get_folder_access_levels(organization_id, folder_ids, owner_id)
      where access_level = 'contributor') <> 3 then
    raise exception 'The owner should reach every folder and nothing unknown.';
  end if;

  if (select access_level from public.get_folder_access_levels(organization_id, array[nested_folder_id], staff_id))
      is distinct from 'viewer' then
    raise exception 'A grant on a parent folder did not reach its child.';
  end if;

  if (select access_level from public.get_folder_access_levels(organization_id, array[private_folder_id], staff_id))
      is not null then
    raise exception 'A member without a grant could see a private folder.';
  end if;

  if (select access_level from public.get_document_access_levels(organization_id, array[granted_document_id], manager_id))
      is distinct from 'contributor' then
    raise exception 'A role grant on a folder did not reach its documents.';
  end if;

  if (select access_level from public.get_document_access_levels(organization_id, array[staff_document_id], staff_id))
      is distinct from 'contributor' then
    raise exception 'A creator lost access to their own document.';
  end if;

  if (select access_level from public.get_document_access_levels(organization_id, array[granted_document_id], reviewer_id))
      is distinct from 'viewer' then
    raise exception 'A direct grant did not reach its reviewer.';
  end if;

  if exists (
    select 1
    from public.get_document_access_levels(organization_id, document_ids, outsider_id)
    where access_level is not null
  ) then
    raise exception 'Someone outside the organization was given access.';
  end if;

  begin
    perform *
    from public.get_folder_access_levels(
      organization_id,
      array(select gen_random_uuid() from generate_series(1, 1001)),
      owner_id
    );
    raise exception 'An oversized folder call was accepted.';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform *
    from public.get_document_access_levels(
      organization_id,
      array(select gen_random_uuid() from generate_series(1, 1001)),
      owner_id
    );
    raise exception 'An oversized document call was accepted.';
  exception when sqlstate '22023' then
    null;
  end;

  delete from public.organizations
  where id = organization_id;

  delete from auth.users
  where id in (owner_id, manager_id, staff_id, reviewer_id, outsider_id);
end;
$$;
