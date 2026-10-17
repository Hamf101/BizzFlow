-- The nightly sweep of abandoned uploads reads only pending versions by when
-- their upload URL expired.
create index if not exists document_versions_pending_expiry_idx
  on public.document_versions (upload_authorization_expires_at)
  where status = 'upload_pending';
