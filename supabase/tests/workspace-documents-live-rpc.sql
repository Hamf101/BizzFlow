-- Exercises list_workspace_documents against a real database: for owners,
-- managers, staff, reviewers, and outsiders, in a folder, at the top of Files,
-- and searching, the listing holds exactly the documents the single-document
-- access function lets them open, at the level it answers, and reading it one
-- row at a time by keyset gives the same rows. Creates isolated synthetic rows
-- inside one statement and removes them before returning; any failed check
-- rolls everything back.
do $$
<<workspace_documents_test>>
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
  shared_document_id uuid := gen_random_uuid();
  nested_document_id uuid := gen_random_uuid();
  granted_document_id uuid := gen_random_uuid();
  hidden_document_id uuid := gen_random_uuid();
  staff_document_id uuid := gen_random_uuid();
  archived_document_id uuid := gen_random_uuid();
  actor uuid;
  variant integer;
  view_folder_ids uuid[];
  view_include_root boolean;
  view_visible_folder_ids uuid[];
  view_query text;
  expected integer;
  mismatches integer;
  last_id uuid;
  page_row record;
  paged integer;
begin
  insert into auth.users (id, email, created_at, updated_at)
  select member.id, 'rpc-' || replace(member.id::text, '-', '') || '@example.invalid', now(), now()
  from unnest(array[owner_id, manager_id, staff_id, reviewer_id, outsider_id]) as member(id);

  insert into public.profiles (id, email, full_name)
  select member.id, 'rpc-' || replace(member.id::text, '-', '') || '@example.invalid', 'Workspace documents verification'
  from unnest(array[owner_id, manager_id, staff_id, reviewer_id, outsider_id]) as member(id);

  insert into public.organizations (id, name, slug, created_by)
  values (organization_id, 'Workspace documents verification', 'files-rpc-' || replace(organization_id::text, '-', ''), owner_id);

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

  insert into public.folders (id, org_id, parent_folder_id, name, created_by, updated_by)
  values
    (shared_folder_id, organization_id, null, 'Shared', owner_id, owner_id),
    (private_folder_id, organization_id, null, 'Private', owner_id, owner_id);

  insert into public.folders (id, org_id, parent_folder_id, name, created_by, updated_by)
  values (nested_folder_id, organization_id, shared_folder_id, 'Nested', owner_id, owner_id);

  insert into public.documents (id, org_id, folder_id, title, created_by, updated_by)
  values
    (shared_document_id, organization_id, shared_folder_id, 'Shared document', owner_id, owner_id),
    (nested_document_id, organization_id, nested_folder_id, 'Nested document', owner_id, owner_id),
    (granted_document_id, organization_id, private_folder_id, 'Granted document', owner_id, owner_id),
    (hidden_document_id, organization_id, private_folder_id, 'Hidden document', owner_id, owner_id),
    (staff_document_id, organization_id, null, 'Staff document', staff_id, staff_id),
    (archived_document_id, organization_id, shared_folder_id, 'Archived document', owner_id, owner_id);

  update public.documents
  set lifecycle_state = 'archived', archived_by = owner_id, archived_at = now()
  where id = archived_document_id;

  insert into public.folder_access_grants (org_id, folder_id, user_id, organization_role, access_level, granted_by)
  values
    (organization_id, shared_folder_id, staff_id, null, 'viewer', owner_id),
    (organization_id, private_folder_id, null, 'manager', 'contributor', owner_id);

  -- A reviewer granted more still only views; staff are shared a document by role.
  insert into public.document_access_grants (org_id, document_id, user_id, organization_role, access_level, granted_by)
  values
    (organization_id, granted_document_id, reviewer_id, null, 'contributor', owner_id),
    (organization_id, hidden_document_id, null, 'staff', 'viewer', owner_id);

  foreach actor in array array[owner_id, manager_id, staff_id, reviewer_id, outsider_id] loop
    for variant in 1..5 loop
      -- A folder; two folders; the top of Files with its folders drawn; the
      -- top of Files with none drawn; and a search.
      view_folder_ids := case variant
        when 1 then array[shared_folder_id]
        when 2 then array[nested_folder_id, private_folder_id]
        else array[]::uuid[]
      end;
      view_include_root := variant in (3, 4);
      view_visible_folder_ids := case variant when 3 then array[shared_folder_id, private_folder_id] else array[]::uuid[] end;
      view_query := case variant when 5 then '%document%' end;

      select count(*)
      into mismatches
      from (
        (
          select (listed.document ->> 'id')::uuid as id, listed.access_level
          from public.list_workspace_documents(
            organization_id, actor, array['active']::public.resource_lifecycle_state[], view_folder_ids,
            view_include_root, view_visible_folder_ids, view_query, null, 1000
          ) listed
          except
          select d.id, private.effective_document_access_level(organization_id, d.id, actor)
          from public.documents d
          where d.org_id = organization_id
            and d.lifecycle_state = 'active'
            and case
              when view_query is not null then d.title ilike view_query
              else d.folder_id = any(view_folder_ids)
                or (view_include_root and (d.folder_id is null or not (d.folder_id = any(view_visible_folder_ids))))
            end
            and private.effective_document_access_level(organization_id, d.id, actor) is not null
        )
        union all
        (
          select d.id, private.effective_document_access_level(organization_id, d.id, actor)
          from public.documents d
          where d.org_id = organization_id
            and d.lifecycle_state = 'active'
            and case
              when view_query is not null then d.title ilike view_query
              else d.folder_id = any(view_folder_ids)
                or (view_include_root and (d.folder_id is null or not (d.folder_id = any(view_visible_folder_ids))))
            end
            and private.effective_document_access_level(organization_id, d.id, actor) is not null
          except
          select (listed.document ->> 'id')::uuid, listed.access_level
          from public.list_workspace_documents(
            organization_id, actor, array['active']::public.resource_lifecycle_state[], view_folder_ids,
            view_include_root, view_visible_folder_ids, view_query, null, 1000
          ) listed
        )
      ) differences;

      if mismatches <> 0 then
        raise exception 'The listing disagrees with the single-document access for % in view %.', actor, variant;
      end if;

      -- One row at a time, by keyset, gives the same rows in order.
      select count(*)
      into expected
      from public.list_workspace_documents(
        organization_id, actor, array['active']::public.resource_lifecycle_state[], view_folder_ids,
        view_include_root, view_visible_folder_ids, view_query, null, 1000
      );
      last_id := null;
      paged := 0;

      loop
        select (listed.document ->> 'id')::uuid as id
        into page_row
        from public.list_workspace_documents(
          organization_id, actor, array['active']::public.resource_lifecycle_state[], view_folder_ids,
          view_include_root, view_visible_folder_ids, view_query, last_id, 1
        ) listed;

        exit when not found;

        if last_id is not null and page_row.id <= last_id then
          raise exception 'Keyset reading went backwards for % in view %.', actor, variant;
        end if;

        last_id := page_row.id;
        paged := paged + 1;
      end loop;

      if paged <> expected then
        raise exception 'Keyset reading found % of % rows for % in view %.', paged, expected, actor, variant;
      end if;
    end loop;
  end loop;

  -- The agreement above is not vacuous: each rule shows up in the listing.
  if (
    select count(*)
    from public.list_workspace_documents(
      organization_id, owner_id, array['active']::public.resource_lifecycle_state[], array[]::uuid[], true, array[]::uuid[], null, null, 1000
    ) listed
    where listed.access_level = 'contributor'
  ) <> 5 then
    raise exception 'The owner should open every active document, and nothing archived.';
  end if;

  if (
    select array_agg(listed.access_level order by listed.document ->> 'title')
    from public.list_workspace_documents(
      organization_id, staff_id, array['active']::public.resource_lifecycle_state[], array[]::uuid[], false, array[]::uuid[], '%document%', null, 1000
    ) listed
  ) is distinct from array['viewer', 'viewer', 'viewer', 'contributor']::public.resource_access_level[] then
    raise exception 'Staff should view what their role was shared, the shared folder and its child, and edit their own document.';
  end if;

  if (
    select array_agg(listed.document ->> 'title' order by listed.document ->> 'title')
    from public.list_workspace_documents(
      organization_id, manager_id, array['active']::public.resource_lifecycle_state[], array[private_folder_id], false, array[]::uuid[], null, null, 1000
    ) listed
    where listed.access_level = 'contributor'
  ) is distinct from array['Granted document', 'Hidden document'] then
    raise exception 'A role grant on a folder did not reach its documents.';
  end if;

  if (
    select array_agg(listed.document ->> 'title')
    from public.list_workspace_documents(
      organization_id, reviewer_id, array['active']::public.resource_lifecycle_state[], array[]::uuid[], true, array[]::uuid[], null, null, 1000
    ) listed
    where listed.access_level = 'viewer'
  ) is distinct from array['Granted document'] then
    raise exception 'A reviewer should view only what was shared with them.';
  end if;

  if exists (
    select 1
    from public.list_workspace_documents(
      organization_id, outsider_id, array['active', 'archived']::public.resource_lifecycle_state[], array[]::uuid[], true, array[]::uuid[], null, null, 1000
    )
  ) then
    raise exception 'Someone outside the organization was shown a document.';
  end if;

  begin
    perform *
    from public.list_workspace_documents(
      organization_id, owner_id, array['active']::public.resource_lifecycle_state[], array[]::uuid[], true, array[]::uuid[], null, null, 1001
    );
    raise exception 'An oversized batch was accepted.';
  exception when sqlstate '22023' then
    null;
  end;

  delete from public.organizations
  where id = organization_id;

  delete from auth.users
  where id in (owner_id, manager_id, staff_id, reviewer_id, outsider_id);
end;
$$;
