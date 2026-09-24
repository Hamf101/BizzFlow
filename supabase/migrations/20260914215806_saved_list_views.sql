-- A member's own named views of a list: the list's canonical settings under a
-- name. Views belong to the membership, so they go when it goes. Signed-in
-- sessions never touch the table; the saved-view service reads and writes it
-- for the member, checking the membership first.
create table public.saved_list_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  list text not null
    check (list in ('documents', 'submissions', 'tasks', 'templates', 'audit-log')),
  name text not null
    check (name = btrim(name) and char_length(name) between 1 and 40),
  query text not null
    check (char_length(query) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, user_id)
    references public.organization_memberships (org_id, user_id) on delete cascade
);

-- One name per member, list, and workspace, whatever its case; the index also
-- serves reading and counting a member's views of a list.
create unique index saved_list_views_member_list_name_idx
  on public.saved_list_views (org_id, user_id, list, lower(name));

create trigger saved_list_views_set_updated_at
  before update on public.saved_list_views
  for each row execute function public.set_updated_at();

alter table public.saved_list_views enable row level security;
alter table public.saved_list_views force row level security;

revoke all privileges on table public.saved_list_views from anon, authenticated;
grant select, insert, update, delete on table public.saved_list_views to service_role;

notify pgrst, 'reload schema';
