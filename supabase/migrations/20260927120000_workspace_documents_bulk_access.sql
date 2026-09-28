-- Files decided access one document at a time: every row re-read the member's
-- membership, the document, and its folder's whole lineage, so a search of a
-- 6,612-file workspace read 126,795 buffers in 4.3 s per batch. The listing
-- now reads the membership once, decides each folder its documents sit in
-- once, and joins document grants in the same query. The answers are the ones
-- private.effective_document_access_level gives; the live test compares them
-- for every role.
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

notify pgrst, 'reload schema';
