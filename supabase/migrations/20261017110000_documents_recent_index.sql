-- Recent documents (home, search's first letter) sort a workspace's active
-- documents by last change; this index reads them in that order.
create index if not exists documents_org_lifecycle_updated_idx
  on public.documents (org_id, lifecycle_state, updated_at desc);
