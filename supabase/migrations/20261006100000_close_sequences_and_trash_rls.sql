-- Found by supabase/tests/catalog-security.sql.
--
-- 1. private.resource_trash_operations was created without row level security.
--    Only service_role reaches it today, but every tenant table carries forced RLS.
-- 2. New sequences in public inherit Supabase's default grants, so anon and
--    authenticated held UPDATE (nextval/setval) on audit_logs_seq_seq.
--    20260912194858 closed the default for tables only; close it for sequences too.

alter table private.resource_trash_operations enable row level security;
alter table private.resource_trash_operations force row level security;

revoke all on all sequences in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
