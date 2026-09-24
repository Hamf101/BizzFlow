-- Searching Files only ever looked inside the open folder, because the page
-- filtered the documents it had already read. A member searching from the top
-- of Files found nothing filed anywhere. The listing now takes a title pattern
-- and answers from the whole lifecycle view instead of one folder's scope,
-- with the same access applied while it reads.
--
-- The caller escapes the pattern with `escapeLikePattern`, exactly as the
-- other lists do before their own `ilike`; null means no search.

drop function if exists public.list_workspace_documents(
  uuid, uuid, public.resource_lifecycle_state[], uuid[], boolean, uuid[], uuid, integer
);

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
begin
  if row_limit < 1 or row_limit > 1000 then
    raise exception 'Between 1 and 1000 documents per call.'
      using errcode = '22023';
  end if;

  -- ponytail: access is decided one document at a time, so a member who may
  -- open few of many pages through the folder to fill a batch. Narrow the scan
  -- with an access index when a folder's listing gets slow.
  return query
  select to_jsonb(picked), granted.access_level
  from public.documents as d
  cross join lateral (
    select
      d.id,
      d.org_id,
      d.folder_id,
      d.title,
      d.description,
      d.current_version_id,
      d.source_kind,
      d.template_id,
      d.template_revision,
      d.lifecycle_state,
      d.created_by,
      d.updated_by,
      d.archived_by,
      d.archived_at,
      d.trashed_by,
      d.trashed_at,
      d.purge_after,
      d.pre_trash_lifecycle_state,
      d.trash_operation_id,
      d.created_at,
      d.updated_at
  ) as picked
  cross join lateral (
    select private.effective_document_access_level(
      target_org_id,
      d.id,
      target_actor_user_id
    ) as access_level
  ) as granted
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
    and granted.access_level is not null
  order by d.id
  limit row_limit;
end;
$$;

revoke all on function public.list_workspace_documents(
  uuid, uuid, public.resource_lifecycle_state[], uuid[], boolean, uuid[], text, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_workspace_documents(
  uuid, uuid, public.resource_lifecycle_state[], uuid[], boolean, uuid[], text, uuid, integer
) to service_role;

comment on function public.list_workspace_documents(
  uuid, uuid, public.resource_lifecycle_state[], uuid[], boolean, uuid[], text, uuid, integer
) is
  'One keyset batch of the documents a Files view draws: those filed in the given folders, optionally those the top of Files takes in, or — with a title pattern — those matching anywhere in the lifecycle view. Each carries the member''s effective access. Service role only.';

notify pgrst, 'reload schema';
