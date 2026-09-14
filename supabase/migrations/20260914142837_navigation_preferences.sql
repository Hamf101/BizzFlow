-- Names belong to the workspace; ordering belongs to a member in that workspace.
-- Existing forced RLS and service-only write privileges continue to apply.
alter table public.organizations
  add column navigation_labels jsonb not null default '{}'::jsonb
    check (jsonb_typeof(navigation_labels) = 'object'),
  add column navigation_revision integer not null default 0
    check (navigation_revision >= 0);

alter table public.organization_memberships
  add column navigation_order text[] not null default '{}'::text[]
    check (cardinality(navigation_order) <= 8 and navigation_order <@ array[
      '/dashboard', '/people', '/documents', '/templates',
      '/submissions', '/tasks', '/audit-log', '/settings'
    ]::text[]);

-- Grant only these new fields, including installations with restricted service writes.
grant update (navigation_labels, navigation_revision) on public.organizations to service_role;
