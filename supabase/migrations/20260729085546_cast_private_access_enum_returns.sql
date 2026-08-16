-- Keep PL/pgSQL enum returns explicit so database lint can prove the helper
-- contract without relying on assignment-time casts from unknown literals.

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
    return 'contributor'::public.resource_access_level;
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
    return 'viewer'::public.resource_access_level;
  end if;

  return 'contributor'::public.resource_access_level;
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
    return 'contributor'::public.resource_access_level;
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
    return 'viewer'::public.resource_access_level;
  end if;

  return 'contributor'::public.resource_access_level;
end;
$$;

revoke all on function private.effective_folder_access_level(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.effective_document_access_level(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.effective_folder_access_level(uuid, uuid, uuid)
  to service_role;
grant execute on function private.effective_document_access_level(uuid, uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
