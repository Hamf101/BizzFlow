-- Exercises the two "share without inheriting" switches against a real
-- database. A folder that does not inherit keeps its own grants and stops
-- taking in access from the folders above; a document that does not inherit
-- ignores its folder. Every answer is read from the single-item functions, and
-- the workspace listing is compared with them, because the listing decides the
-- same thing set-wise. Creates isolated synthetic rows inside one statement and
-- removes them before returning; any failed check rolls everything back.
do $$
<<sharing_inheritance_test>>
declare
  owner_id uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  staff_id uuid := gen_random_uuid();
  reviewer_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  folder_a uuid := gen_random_uuid();
  folder_b uuid := gen_random_uuid();
  folder_c uuid := gen_random_uuid();
  doc_a uuid := gen_random_uuid();
  doc_b uuid := gen_random_uuid();
  doc_c uuid := gen_random_uuid();
  doc_x uuid := gen_random_uuid();
  doc_y uuid := gen_random_uuid();
  doc_z uuid := gen_random_uuid();
  actor uuid;
  mismatches integer;
begin
  insert into auth.users (id, email, created_at, updated_at)
  select member.id, 'share-' || replace(member.id::text, '-', '') || '@example.invalid', now(), now()
  from unnest(array[owner_id, manager_id, staff_id, reviewer_id]) as member(id);

  insert into public.profiles (id, email, full_name)
  select member.id, 'share-' || replace(member.id::text, '-', '') || '@example.invalid', 'Sharing verification'
  from unnest(array[owner_id, manager_id, staff_id, reviewer_id]) as member(id);

  insert into public.organizations (id, name, slug, created_by)
  values (organization_id, 'Sharing verification', 'share-' || replace(organization_id::text, '-', ''), owner_id);

  if not exists (
    select 1 from public.organization_memberships membership
    where membership.org_id = organization_id and membership.user_id = owner_id
  ) then
    insert into public.organization_memberships (org_id, user_id, role, status)
    values (organization_id, owner_id, 'owner_admin', 'active');
  end if;

  insert into public.organization_memberships (org_id, user_id, role, status)
  values
    (organization_id, manager_id, 'manager', 'active'),
    (organization_id, staff_id, 'staff', 'active'),
    (organization_id, reviewer_id, 'external_reviewer', 'active');

  -- A holds B (does not inherit) and C (inherits).
  insert into public.folders (id, org_id, parent_folder_id, name, created_by, updated_by, share_inherit)
  values (folder_a, organization_id, null, 'A', owner_id, owner_id, true);
  insert into public.folders (id, org_id, parent_folder_id, name, created_by, updated_by, share_inherit)
  values
    (folder_b, organization_id, folder_a, 'B', owner_id, owner_id, false),
    (folder_c, organization_id, folder_a, 'C', owner_id, owner_id, true);

  insert into public.documents (id, org_id, folder_id, title, created_by, updated_by, share_inherit)
  values
    (doc_a, organization_id, folder_a, 'In A', owner_id, owner_id, true),
    (doc_b, organization_id, folder_b, 'In B', owner_id, owner_id, true),
    (doc_c, organization_id, folder_c, 'In C', owner_id, owner_id, true),
    (doc_x, organization_id, folder_a, 'Alone in A', owner_id, owner_id, false),
    (doc_y, organization_id, folder_a, 'Alone in A, shared', owner_id, owner_id, false),
    (doc_z, organization_id, folder_b, 'In B, shared', owner_id, owner_id, true);

  insert into public.folder_access_grants (org_id, folder_id, user_id, organization_role, access_level, granted_by)
  values
    (organization_id, folder_a, staff_id, null, 'viewer', owner_id),
    (organization_id, folder_a, null, 'manager', 'contributor', owner_id);

  insert into public.document_access_grants (org_id, document_id, user_id, organization_role, access_level, granted_by)
  values
    (organization_id, doc_y, staff_id, null, 'viewer', owner_id),
    (organization_id, doc_z, reviewer_id, null, 'viewer', owner_id);

  -- Staff: A and C through the grant on A; B keeps to itself.
  if private.effective_folder_access_level(organization_id, folder_a, staff_id) is distinct from 'viewer'
     or private.effective_folder_access_level(organization_id, folder_c, staff_id) is distinct from 'viewer' then
    raise exception 'A folder that inherits should take in the access of the folder above it.';
  end if;

  if private.effective_folder_access_level(organization_id, folder_b, staff_id) is not null then
    raise exception 'A folder that does not inherit took in access from the folder above it.';
  end if;

  if private.effective_document_access_level(organization_id, doc_a, staff_id) is distinct from 'viewer'
     or private.effective_document_access_level(organization_id, doc_c, staff_id) is distinct from 'viewer' then
    raise exception 'A document that inherits should take in its folder''s access.';
  end if;

  if private.effective_document_access_level(organization_id, doc_b, staff_id) is not null then
    raise exception 'A document inside a folder that does not inherit took in access from above that folder.';
  end if;

  if private.effective_document_access_level(organization_id, doc_x, staff_id) is not null then
    raise exception 'A document that does not inherit took in its folder''s access.';
  end if;

  if private.effective_document_access_level(organization_id, doc_y, staff_id) is distinct from 'viewer' then
    raise exception 'A document that does not inherit should still keep its own grants.';
  end if;

  -- Roles follow the same rules as people.
  if private.effective_document_access_level(organization_id, doc_a, manager_id) is distinct from 'contributor'
     or private.effective_document_access_level(organization_id, doc_b, manager_id) is not null
     or private.effective_document_access_level(organization_id, doc_x, manager_id) is not null then
    raise exception 'A role grant on a folder should reach what inherits and stop where inheriting stops.';
  end if;

  if private.effective_document_access_level(organization_id, doc_z, reviewer_id) is distinct from 'viewer'
     or private.effective_document_access_level(organization_id, doc_a, reviewer_id) is not null then
    raise exception 'A reviewer should view only what was shared with them.';
  end if;

  -- Owners are never shut out, and the creator keeps their own work.
  if private.effective_document_access_level(organization_id, doc_x, owner_id) is distinct from 'contributor'
     or private.effective_folder_access_level(organization_id, folder_b, owner_id) is distinct from 'contributor' then
    raise exception 'An owner admin must always have access.';
  end if;

  -- Its own grant lets someone into the folder that does not inherit, and
  -- turning inheritance back on adds what is above it.
  insert into public.folder_access_grants (org_id, folder_id, user_id, organization_role, access_level, granted_by)
  values (organization_id, folder_b, staff_id, null, 'contributor', owner_id);

  if private.effective_folder_access_level(organization_id, folder_b, staff_id) is distinct from 'contributor'
     or private.effective_document_access_level(organization_id, doc_b, staff_id) is distinct from 'contributor' then
    raise exception 'A grant on a folder that does not inherit should reach its documents.';
  end if;

  update public.folders set share_inherit = true where id = folder_b;
  delete from public.folder_access_grants where folder_id = folder_b;

  if private.effective_folder_access_level(organization_id, folder_b, staff_id) is distinct from 'viewer' then
    raise exception 'Turning inheritance back on should bring the folder above''s access back.';
  end if;

  update public.folders set share_inherit = false where id = folder_b;

  -- The listing decides the same thing set-wise; it must agree everywhere.
  foreach actor in array array[owner_id, manager_id, staff_id, reviewer_id] loop
    select count(*)
    into mismatches
    from (
      (
        select (listed.document ->> 'id')::uuid as id, listed.access_level
        from public.list_workspace_documents(
          organization_id, actor, array['active']::public.resource_lifecycle_state[], array[]::uuid[],
          false, array[]::uuid[], '%', null, 1000
        ) listed
        except
        select d.id, private.effective_document_access_level(organization_id, d.id, actor)
        from public.documents d
        where d.org_id = organization_id
          and private.effective_document_access_level(organization_id, d.id, actor) is not null
      )
      union all
      (
        select d.id, private.effective_document_access_level(organization_id, d.id, actor)
        from public.documents d
        where d.org_id = organization_id
          and private.effective_document_access_level(organization_id, d.id, actor) is not null
        except
        select (listed.document ->> 'id')::uuid, listed.access_level
        from public.list_workspace_documents(
          organization_id, actor, array['active']::public.resource_lifecycle_state[], array[]::uuid[],
          false, array[]::uuid[], '%', null, 1000
        ) listed
      )
    ) differences;

    if mismatches <> 0 then
      raise exception 'The listing disagrees with the single-document access for % once inheritance is switched off.', actor;
    end if;
  end loop;

  -- A member hears their own notices channel and no one else's.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'realtime' and tablename = 'messages' and policyname = 'Members hear their own notices'
  ) then
    raise exception 'The notices policy is missing.';
  end if;

  delete from public.organizations
  where id = organization_id;

  delete from auth.users
  where id in (owner_id, manager_id, staff_id, reviewer_id);
end;
$$;
