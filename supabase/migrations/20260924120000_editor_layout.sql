-- Where a person keeps the editor's dock and zoom. It belongs to the account,
-- not to a workspace, so the tools sit in the same place on every device. Only
-- the editor layout service writes it, for the signed-in person; the service
-- role already holds update on profiles.
alter table public.profiles
  add column editor_layout jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(editor_layout) = 'object'
      and pg_column_size(editor_layout) <= 1024
    );

notify pgrst, 'reload schema';
