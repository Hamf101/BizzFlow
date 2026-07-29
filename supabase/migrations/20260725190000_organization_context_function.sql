-- Collapses the per-request organization-context lookup (oldest active
-- membership + its organization) from two PostgREST round trips into one
-- read-only function call.

create or replace function public.get_current_organization_context(
  target_user_id uuid
)
returns table (
  membership_id uuid,
  org_id uuid,
  user_id uuid,
  role text,
  status text,
  membership_created_at timestamptz,
  membership_updated_at timestamptz,
  organization_name text,
  organization_slug text,
  organization_created_by uuid,
  organization_created_at timestamptz,
  organization_updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    membership.id,
    membership.org_id,
    membership.user_id,
    membership.role::text,
    membership.status::text,
    membership.created_at,
    membership.updated_at,
    organization.name,
    organization.slug,
    organization.created_by,
    organization.created_at,
    organization.updated_at
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.org_id
  where membership.user_id = target_user_id
    and membership.status = 'active'
  order by membership.created_at asc, membership.id asc
  limit 1
$$;

revoke all on function public.get_current_organization_context(uuid)
  from public, anon, authenticated;

grant execute on function public.get_current_organization_context(uuid)
  to service_role;

notify pgrst, 'reload schema';
