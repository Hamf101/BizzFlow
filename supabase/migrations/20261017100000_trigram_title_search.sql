-- Title search ("contains these letters", ilike '%…%') read whole tables:
-- no index serves a leading wildcard. Trigram GIN indexes do, from three
-- letters on; Postgres combines them with each table's org_id index.

create extension if not exists pg_trgm with schema extensions;

create index if not exists documents_title_trgm_idx
  on public.documents using gin (title extensions.gin_trgm_ops);
create index if not exists document_template_versions_title_trgm_idx
  on public.document_template_versions using gin (title extensions.gin_trgm_ops);
create index if not exists submissions_title_trgm_idx
  on public.submissions using gin (title extensions.gin_trgm_ops);
create index if not exists tasks_title_trgm_idx
  on public.tasks using gin (title extensions.gin_trgm_ops);
