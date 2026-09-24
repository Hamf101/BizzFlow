-- Close the two gaps left by the original public-form migration:
--
-- 1. Table owners must not be able to bypass the tenant policies accidentally.
-- 2. Data API access must be explicit for both application roles. Bypass-RLS on
--    service_role does not itself confer table privileges.
alter table public.public_form_links force row level security;

revoke all on table public.public_form_links
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.public_form_links
  to authenticated;

grant select, insert, update on table public.public_form_links
  to service_role;

notify pgrst, 'reload schema';
