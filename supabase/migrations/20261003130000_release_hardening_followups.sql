-- Follow-ups from the dev-1 release audit.

-- A joined guest holds one grant per document: the service reads it with
-- maybeSingle(), so a second row would make their access unreadable. The old
-- per-user index is kept for listing a guest's documents.
create unique index document_guest_grants_document_user_key
  on public.document_guest_grants (document_id, user_id)
  where user_id is not null;
