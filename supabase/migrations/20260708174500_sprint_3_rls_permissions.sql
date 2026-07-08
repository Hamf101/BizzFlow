create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_logs_action_length check (char_length(action) between 3 and 120),
  constraint audit_logs_target_type_length check (char_length(target_type) between 3 and 80),
  constraint audit_logs_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists audit_logs_org_created_at_idx
  on public.audit_logs (org_id, created_at desc);

create index if not exists audit_logs_actor_user_idx
  on public.audit_logs (actor_user_id);

create index if not exists audit_logs_target_idx
  on public.audit_logs (target_type, target_id);

alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

grant usage on schema public to authenticated, service_role;
grant usage on type public.organization_role to authenticated, service_role;
grant usage on type public.membership_status to authenticated, service_role;
grant usage on type public.invite_status to authenticated, service_role;

grant select, insert, update on table public.profiles to authenticated;
grant select on table public.organizations to authenticated;
grant select on table public.organization_memberships to authenticated;
grant select on table public.invites to authenticated;
grant select on table public.audit_logs to authenticated;

grant select, insert, update on table public.profiles to service_role;
grant select, insert, delete on table public.organizations to service_role;
grant select, insert, update on table public.organization_memberships to service_role;
grant select, insert, update on table public.invites to service_role;
grant select, insert on table public.audit_logs to service_role;

drop policy if exists audit_logs_select_manager on public.audit_logs;

create policy audit_logs_select_manager
  on public.audit_logs
  for select
  to authenticated
  using ((select public.organization_role_for(org_id)) in ('owner_admin', 'manager'));

drop policy if exists organizations_insert_self on public.organizations;
drop policy if exists organization_memberships_insert_owner on public.organization_memberships;
drop policy if exists organization_memberships_update_owner on public.organization_memberships;
drop policy if exists invites_insert_manager on public.invites;
drop policy if exists invites_update_manager on public.invites;

revoke insert, update, delete on table public.organizations from authenticated;
revoke insert, update, delete on table public.organization_memberships from authenticated;
revoke insert, update, delete on table public.invites from authenticated;

notify pgrst, 'reload schema';
