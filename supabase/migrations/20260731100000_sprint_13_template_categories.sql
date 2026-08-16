-- ---------------------------------------------------------------------------
-- Sprint 13: template categories.
--
-- "Template categories" was a build item, but no category ever reached the
-- database: it existed only as a TypeScript union on the starter definitions,
-- and the seeder never wrote it. This adds the column the templates list can
-- actually filter on.
--
-- Nullable by design — every template that predates this migration is
-- uncategorised, and an uncategorised template is a legitimate state, not a
-- backfill gap.
-- ---------------------------------------------------------------------------

alter table public.document_templates
  add column if not exists category text;

alter table public.document_templates
  drop constraint if exists document_templates_category_check;

alter table public.document_templates
  add constraint document_templates_category_check
    check (
      category is null
      or (
        category = btrim(category)
        and char_length(category) between 1 and 40
      )
    );

-- Supports the tenant-scoped category filter on the templates list.
create index if not exists document_templates_org_category_idx
  on public.document_templates (org_id, category)
  where category is not null;

comment on column public.document_templates.category is
  'Optional grouping label shown as a filter on the templates list.';

notify pgrst, 'reload schema';
