create extension if not exists pgcrypto;

do $$
begin
  create type public.organization_role as enum (
    'owner_admin',
    'manager',
    'staff',
    'external_reviewer'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.membership_status as enum ('active', 'disabled');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.invite_status as enum ('pending', 'accepted', 'revoked', 'expired');
exception
  when duplicate_object then null;
end $$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_lowercase check (email is null or email = lower(email))
);

create unique index profiles_email_unique_idx
  on public.profiles (lower(email))
  where email is not null;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_length check (char_length(name) between 2 and 120),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index organizations_created_by_idx
  on public.organizations (created_by);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.organization_role not null,
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index organization_memberships_org_user_idx
  on public.organization_memberships (org_id, user_id);

create index organization_memberships_user_idx
  on public.organization_memberships (user_id);

create index organization_memberships_active_role_idx
  on public.organization_memberships (org_id, role)
  where status = 'active';

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role public.organization_role not null default 'staff',
  token text not null unique,
  invited_by uuid references public.profiles (id) on delete set null,
  status public.invite_status not null default 'pending',
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invites_email_lowercase check (email = lower(email)),
  constraint invites_non_owner_role check (role <> 'owner_admin')
);

create index invites_org_status_idx
  on public.invites (org_id, status);

create index invites_email_status_idx
  on public.invites (email, status);

create unique index invites_pending_org_email_unique_idx
  on public.invites (org_id, email)
  where status = 'pending';

create index invites_pending_token_idx
  on public.invites (token)
  where status = 'pending';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create trigger organization_memberships_set_updated_at
  before update on public.organization_memberships
  for each row execute function public.set_updated_at();

create trigger invites_set_updated_at
  before update on public.invites
  for each row execute function public.set_updated_at();

create or replace function public.is_organization_member(target_org_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.org_id = target_org_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  );
$$;

create or replace function public.organization_role_for(target_org_id uuid)
returns public.organization_role
language sql
security definer
set search_path = ''
as $$
  select membership.role
  from public.organization_memberships membership
  where membership.org_id = target_org_id
    and membership.user_id = (select auth.uid())
    and membership.status = 'active'
  limit 1;
$$;

create or replace function public.shares_organization_with_profile(target_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships current_membership
    join public.organization_memberships target_membership
      on target_membership.org_id = current_membership.org_id
    where current_membership.user_id = (select auth.uid())
      and current_membership.status = 'active'
      and target_membership.user_id = target_user_id
      and target_membership.status = 'active'
  );
$$;

revoke all on function public.is_organization_member(uuid) from public;
revoke all on function public.organization_role_for(uuid) from public;
revoke all on function public.shares_organization_with_profile(uuid) from public;

grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.organization_role_for(uuid) to authenticated;
grant execute on function public.shares_organization_with_profile(uuid) to authenticated;

grant usage on schema public to authenticated, service_role;
grant usage on type public.organization_role to authenticated, service_role;
grant usage on type public.membership_status to authenticated, service_role;
grant usage on type public.invite_status to authenticated, service_role;

grant select, insert, update on table public.profiles to authenticated;
grant select, insert on table public.organizations to authenticated;
grant select, insert, update on table public.organization_memberships to authenticated;
grant select, insert, update on table public.invites to authenticated;

grant select, insert, update on table public.profiles to service_role;
grant select, insert, delete on table public.organizations to service_role;
grant select, insert, update on table public.organization_memberships to service_role;
grant select, insert, update on table public.invites to service_role;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.invites enable row level security;

alter table public.profiles force row level security;
alter table public.organizations force row level security;
alter table public.organization_memberships force row level security;
alter table public.invites force row level security;

create policy profiles_select_related
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or (select public.shares_organization_with_profile(id))
  );

create policy profiles_insert_self
  on public.profiles
  for insert
  to authenticated
  with check (id = (select auth.uid()));

create policy profiles_update_self
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy organizations_select_member
  on public.organizations
  for select
  to authenticated
  using ((select public.is_organization_member(id)));

create policy organizations_insert_self
  on public.organizations
  for insert
  to authenticated
  with check (created_by = (select auth.uid()));

create policy organization_memberships_select_member
  on public.organization_memberships
  for select
  to authenticated
  using ((select public.is_organization_member(org_id)));

create policy organization_memberships_insert_owner
  on public.organization_memberships
  for insert
  to authenticated
  with check ((select public.organization_role_for(org_id)) = 'owner_admin');

create policy organization_memberships_update_owner
  on public.organization_memberships
  for update
  to authenticated
  using ((select public.organization_role_for(org_id)) = 'owner_admin')
  with check ((select public.organization_role_for(org_id)) = 'owner_admin');

create policy invites_select_manager
  on public.invites
  for select
  to authenticated
  using ((select public.organization_role_for(org_id)) in ('owner_admin', 'manager'));

create policy invites_insert_manager
  on public.invites
  for insert
  to authenticated
  with check (
    (select public.organization_role_for(org_id)) in ('owner_admin', 'manager')
    and role <> 'owner_admin'
  );

create policy invites_update_manager
  on public.invites
  for update
  to authenticated
  using ((select public.organization_role_for(org_id)) in ('owner_admin', 'manager'))
  with check ((select public.organization_role_for(org_id)) in ('owner_admin', 'manager'));

notify pgrst, 'reload schema';
