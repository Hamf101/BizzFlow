-- Contract step for multi-reviewer review (20260930110000): reviewers are named
-- with set_submission_reviewers, and no released app calls assign_internal_submission
-- any more (main and dev-1 checked 2026-10-25). Recreate it from
-- 20261005100000_submissions_sharing_fixes.sql if this ever has to be undone.
drop function if exists public.assign_internal_submission(uuid, uuid, integer, uuid, uuid);
