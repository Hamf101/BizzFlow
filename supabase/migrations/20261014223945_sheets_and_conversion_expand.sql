-- Sheets, and tracking for turning uploads into editable files.
-- A sheet is a document whose cells live in the row (sheet_content); its
-- values are worked out by the server, never stored. An upload may later be
-- converted, once, into a generated document or a sheet, keeping the version
-- it came from as original_version_id.
-- Expand only: a widened kind, new nullable columns, constraints, and one new
-- trigger. Nothing is granted: signed-in users still reach documents only
-- through services.

alter table public.documents
  drop constraint documents_source_kind_check,
  add constraint documents_source_kind_check
    check (source_kind in ('upload', 'generated', 'sheet'));

alter table public.documents
  add column sheet_content jsonb,
  add column conversion_state text,
  add column conversion_error text,
  add column original_version_id uuid,
  add constraint documents_sheet_content_shape
    check (
      (source_kind = 'sheet') = (sheet_content is not null)
      and (sheet_content is null or jsonb_typeof(sheet_content) = 'object')
    ),
  add constraint documents_sheet_content_size
    check (sheet_content is null or octet_length(sheet_content::text) <= 4000000),
  add constraint documents_conversion_state_check
    check (conversion_state in ('pending', 'converting', 'done', 'failed', 'skipped')),
  add constraint documents_conversion_error_length
    check (char_length(conversion_error) <= 500),
  -- The original is one of the document's own versions, as current_version_id is.
  add constraint documents_original_version_id_document_id_fkey
    foreign key (original_version_id, id)
    references public.document_versions (id, document_id);

create index documents_original_version_id_idx
  on public.documents (original_version_id)
  where original_version_id is not null;

-- A sheet, like an upload, has no template behind it.
alter table public.documents
  drop constraint documents_generated_snapshot_check,
  add constraint documents_generated_snapshot_check
  check (
    (
      source_kind in ('upload', 'sheet')
      and template_id is null
      and template_revision is null
      and template_snapshot is null
    )
    or
    (
      source_kind = 'generated'
      and template_snapshot is not null
      and jsonb_typeof(template_snapshot) = 'object'
      and (
        (
          template_snapshot ->> 'schemaVersion' = '2'
          and template_snapshot
            ?& array['schemaVersion', 'branding', 'blocks']
          and template_snapshot
            - array['schemaVersion', 'branding', 'blocks']::text[]
            = '{}'::jsonb
          and jsonb_typeof(template_snapshot -> 'branding') = 'object'
          and jsonb_typeof(template_snapshot -> 'blocks') = 'array'
        )
        or
        (
          template_snapshot ->> 'schemaVersion' = '3'
          and template_snapshot
            ?& array[
              'schemaVersion',
              'branding',
              'blocks',
              'layout',
              'sections',
              'fieldGroups',
              'blockRules'
            ]
          and template_snapshot
            - array[
              'schemaVersion',
              'branding',
              'blocks',
              'layout',
              'sections',
              'fieldGroups',
              'blockRules'
            ]::text[]
            = '{}'::jsonb
          and jsonb_typeof(template_snapshot -> 'branding') = 'object'
          and jsonb_typeof(template_snapshot -> 'blocks') = 'array'
          and jsonb_typeof(template_snapshot -> 'layout') = 'object'
          and jsonb_typeof(template_snapshot -> 'sections') = 'array'
          and jsonb_typeof(template_snapshot -> 'fieldGroups') = 'array'
          and jsonb_typeof(template_snapshot -> 'blockRules') = 'array'
        )
      )
      and (
        (template_id is null and template_revision is null)
        or (template_id is not null and template_revision is not null)
      )
    )
  );

-- A document changes kind once at most: an upload becomes a generated
-- document or a sheet in the same update that keeps its original version, and
-- that original never changes after. Every other kind change stays refused.
create or replace function private.enforce_document_source_kind_promotion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(new.source_kind, new.original_version_id)
      is distinct from row(old.source_kind, old.original_version_id)
    and not (
      old.source_kind = 'upload'
      and new.source_kind in ('generated', 'sheet')
      and old.original_version_id is null
      and new.original_version_id is not null
    ) then
    raise exception 'A document changes kind only once, from an upload that keeps its original.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_document_source_kind_promotion()
  from public, anon, authenticated;

create trigger documents_enforce_source_kind_promotion
  before update of source_kind, original_version_id
  on public.documents
  for each row execute function private.enforce_document_source_kind_promotion();

-- The snapshot trigger refuses every kind change, so it now stands aside for
-- exactly the promotion above, which brings its template fields with it.
-- Only the trigger is recreated; its function is left as it is.
drop trigger documents_prevent_snapshot_mutation on public.documents;

create trigger documents_prevent_snapshot_mutation
  before update of source_kind, template_id, template_revision, template_snapshot
  on public.documents
  for each row
  when (
    not (
      old.source_kind = 'upload'
      and new.source_kind in ('generated', 'sheet')
      and old.original_version_id is null
      and new.original_version_id is not null
    )
  )
  execute function public.prevent_document_snapshot_mutation();
