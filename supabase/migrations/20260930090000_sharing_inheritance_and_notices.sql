-- Sharing a document or a folder can now stand on its own.
--
-- Until now a document was reachable through its own grants, its creator and
-- every folder above it, with no way to say "only these people". Two switches
-- change that. A folder with share_inherit = false keeps its own grants and
-- creator but no longer takes in access from the folders above it, and a
-- document with share_inherit = false ignores the access its folder gives.
-- Both default to true, so nothing changes until someone turns one off.
--
-- Every reader of access goes through private.effective_folder_access_level
-- and private.effective_document_access_level, except list_workspace_documents,
-- which decides the same thing set-wise; it changes with them and the live test
-- compares them.
--
-- A second policy on realtime.messages lets a member hear a private channel of
-- their own, where the app tells them a document was shared with them.

alter table public.folders
  add column share_inherit boolean not null default true;
alter table public.documents
  add column share_inherit boolean not null default true;

comment on column public.folders.share_inherit is
  'When false, access granted on the folders above is not inherited by this folder or anything in it.';
comment on column public.documents.share_inherit is
  'When false, access granted on the document''s folder and the folders above it is not inherited by this document.';

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
      folder.share_inherit,
      array[folder.id]::uuid[] as visited_ids
    from public.folders folder
    where folder.id = target_folder_id
      and folder.org_id = target_org_id

    union all

    select
      parent.id,
      parent.parent_folder_id,
      parent.created_by,
      parent.share_inherit,
      lineage.visited_ids || parent.id
    from folder_lineage lineage
    join public.folders parent
      on parent.id = lineage.parent_folder_id
     and parent.org_id = target_org_id
    -- A folder that does not inherit ends the walk: what is above it stays above.
    where lineage.share_inherit
      and not parent.id = any(lineage.visited_ids)
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
  document_inherits boolean;
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

  select document.created_by, document.folder_id, document.share_inherit
  into document_creator_id, document_folder_id, document_inherits
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id;

  if not found then
    return null;
  end if;

  if actor_role = 'owner_admin' then
    return 'contributor'::public.resource_access_level;
  end if;

  if document_folder_id is not null and document_inherits then
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

-- The same listing as 20260927120000, except that a document which does not
-- inherit takes nothing from its folder.
create or replace function public.list_workspace_documents(
  target_org_id uuid,
  target_actor_user_id uuid,
  target_lifecycle_states public.resource_lifecycle_state[],
  target_folder_ids uuid[],
  target_include_root boolean,
  target_visible_folder_ids uuid[],
  target_query text,
  after_document_id uuid,
  row_limit integer
)
returns table (
  document jsonb,
  access_level public.resource_access_level
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  actor_role public.organization_role;
begin
  if row_limit < 1 or row_limit > 1000 then
    raise exception 'Between 1 and 1000 documents per call.'
      using errcode = '22023';
  end if;

  select membership.role
  into actor_role
  from public.organization_memberships membership
  where membership.org_id = target_org_id
    and membership.user_id = target_actor_user_id
    and membership.status = 'active';

  if actor_role is null then
    return;
  end if;

  return query
  with listed as materialized (
    select d.*
    from public.documents as d
    where d.org_id = target_org_id
      and d.lifecycle_state = any(target_lifecycle_states)
      and (after_document_id is null or d.id > after_document_id)
      and case
        when target_query is not null then d.title ilike target_query
        else
          d.folder_id = any(target_folder_ids)
          or (
            target_include_root
            and (
              d.folder_id is null
              or not (d.folder_id = any(target_visible_folder_ids))
            )
          )
      end
  ),
  -- Materialized, or the planner folds it into the per-document lookup and
  -- decides each folder again for every document it holds.
  folder_access as materialized (
    select
      folder.id as folder_id,
      private.effective_folder_access_level(
        target_org_id,
        folder.id,
        target_actor_user_id
      ) as level
    from (
      select distinct listed.folder_id as id
      from listed
      where listed.folder_id is not null
        and listed.share_inherit
    ) as folder
    where actor_role <> 'owner_admin'
  ),
  ranked as (
    select
      listed.*,
      case
        when actor_role = 'owner_admin' then 2
        else greatest(
          case when listed.created_by = target_actor_user_id then 2 end,
          (
            select max(case grant_row.access_level when 'contributor' then 2 else 1 end)
            from public.document_access_grants grant_row
            where grant_row.org_id = target_org_id
              and grant_row.document_id = listed.id
              and (
                grant_row.user_id = target_actor_user_id
                or grant_row.organization_role = actor_role
              )
          ),
          (
            select case inherited.level
              when 'contributor' then 2
              when 'viewer' then 1
            end
            from folder_access inherited
            where inherited.folder_id = listed.folder_id
              and listed.share_inherit
          )
        )
      end as access_rank
    from listed
  )
  select
    to_jsonb(picked),
    case
      when actor_role = 'owner_admin' then 'contributor'
      when actor_role = 'external_reviewer' or ranked.access_rank = 1 then 'viewer'
      else 'contributor'
    end::public.resource_access_level
  from ranked
  cross join lateral (
    select
      ranked.id,
      ranked.org_id,
      ranked.folder_id,
      ranked.title,
      ranked.description,
      ranked.current_version_id,
      ranked.source_kind,
      ranked.template_id,
      ranked.template_revision,
      ranked.lifecycle_state,
      ranked.created_by,
      ranked.updated_by,
      ranked.archived_by,
      ranked.archived_at,
      ranked.trashed_by,
      ranked.trashed_at,
      ranked.purge_after,
      ranked.pre_trash_lifecycle_state,
      ranked.trash_operation_id,
      ranked.created_at,
      ranked.updated_at
  ) as picked
  where ranked.access_rank is not null
  order by ranked.id
  limit row_limit;
end;
$$;

revoke all on function public.list_workspace_documents(
  uuid, uuid, public.resource_lifecycle_state[], uuid[], boolean, uuid[], text, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_workspace_documents(
  uuid, uuid, public.resource_lifecycle_state[], uuid[], boolean, uuid[], text, uuid, integer
) to service_role;

-- A member hears only the channel that carries their own id.
create policy "Members hear their own notices"
  on realtime.messages
  for select
  to authenticated
  using ((select realtime.topic()) = 'user:' || (select auth.uid())::text);

notify pgrst, 'reload schema';
