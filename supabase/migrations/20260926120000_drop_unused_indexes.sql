-- Indexes no query can use. Documents have been filtered by lifecycle_state
-- since it replaced archived_at, so the three partial indexes on archived_at
-- only cost a write on every insert. The assignee index on submissions
-- requires assigned_at, which no list asks for; a reviewer's assigned rows
-- are found through submissions_assigned_to_idx.
drop index if exists public.documents_org_active_created_idx;
drop index if exists public.documents_org_folder_active_idx;
drop index if exists public.documents_org_archived_idx;
drop index if exists public.submissions_org_assignee_status_idx;
