-- Answers the effective access of many folders or documents in one call, so a
-- workspace listing costs one round trip per batch of items instead of one per
-- item. Every answer comes from the same private function the single-item
-- lookups use, so the two can never disagree.

create or replace function public.get_folder_access_levels(
  target_org_id uuid,
  target_folder_ids uuid[],
  target_actor_user_id uuid
)
returns table (
  folder_id uuid,
  access_level public.resource_access_level
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if cardinality(target_folder_ids) > 1000 then
    raise exception 'At most 1000 folders per call.'
      using errcode = '22023';
  end if;

  return query
  select
    requested.id,
    private.effective_folder_access_level(
      target_org_id,
      requested.id,
      target_actor_user_id
    )
  from unnest(target_folder_ids) as requested(id)
  where requested.id is not null;
end;
$$;

create or replace function public.get_document_access_levels(
  target_org_id uuid,
  target_document_ids uuid[],
  target_actor_user_id uuid
)
returns table (
  document_id uuid,
  access_level public.resource_access_level
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if cardinality(target_document_ids) > 1000 then
    raise exception 'At most 1000 documents per call.'
      using errcode = '22023';
  end if;

  return query
  select
    requested.id,
    private.effective_document_access_level(
      target_org_id,
      requested.id,
      target_actor_user_id
    )
  from unnest(target_document_ids) as requested(id)
  where requested.id is not null;
end;
$$;

revoke all on function public.get_folder_access_levels(uuid, uuid[], uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_document_access_levels(uuid, uuid[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_folder_access_levels(uuid, uuid[], uuid)
  to service_role;
grant execute on function public.get_document_access_levels(uuid, uuid[], uuid)
  to service_role;

comment on function public.get_folder_access_levels(uuid, uuid[], uuid) is
  'Effective access of up to 1000 folders for one member: one row per requested id, null where the member has none. Service role only.';
comment on function public.get_document_access_levels(uuid, uuid[], uuid) is
  'Effective access of up to 1000 documents for one member: one row per requested id, null where the member has none. Service role only.';

notify pgrst, 'reload schema';
