-- The sidebar gains a Flow tab, so a member's saved tab order may hold it.
-- Widened only: every order saved before still satisfies the new check.
alter table public.organization_memberships
  drop constraint organization_memberships_navigation_order_check,
  add constraint organization_memberships_navigation_order_check
    check (cardinality(navigation_order) <= 9 and navigation_order <@ array[
      '/dashboard', '/flow', '/people', '/documents', '/templates',
      '/submissions', '/tasks', '/audit-log', '/settings'
    ]::text[]);
