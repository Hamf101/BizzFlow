-- Restore the server-only caller's access to the atomic public-form counter.
--
-- The original public-form migration revoked the function's default PUBLIC
-- privilege, correctly preventing anonymous callers from exhausting a link's
-- submission allowance. It did not grant EXECUTE back to service_role, so the
-- trusted public-form service cannot consume that allowance either.
--
-- Revoke every relevant role first so this migration is deterministic even if
-- an environment has drifted, then grant only the server-side service role.
revoke execute
  on function public.increment_public_form_link_submission_count(text)
  from public, anon, authenticated, service_role;

grant execute
  on function public.increment_public_form_link_submission_count(text)
  to service_role;

notify pgrst, 'reload schema';
