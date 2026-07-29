-- Expand canonical template JSON constraints for a dual-read v2/v3 rollout.
-- This migration intentionally does not rewrite immutable document/submission
-- snapshots or replace workflow functions that already traverse root blocks.

alter table public.document_templates
  drop constraint document_templates_content_object;

alter table public.documents
  drop constraint documents_generated_snapshot_check;

alter table public.submissions
  drop constraint submissions_template_snapshot_object;

alter table public.document_templates
  add constraint document_templates_content_object
  check (
    jsonb_typeof(content) = 'object'
    and (
      (
        content ->> 'schemaVersion' = '2'
        and content ?& array['schemaVersion', 'branding', 'blocks']
        and content - array['schemaVersion', 'branding', 'blocks']::text[]
          = '{}'::jsonb
        and jsonb_typeof(content -> 'branding') = 'object'
        and jsonb_typeof(content -> 'blocks') = 'array'
      )
      or
      (
        content ->> 'schemaVersion' = '3'
        and content ?& array[
          'schemaVersion',
          'branding',
          'blocks',
          'layout',
          'sections',
          'fieldGroups',
          'blockRules'
        ]
        and content - array[
          'schemaVersion',
          'branding',
          'blocks',
          'layout',
          'sections',
          'fieldGroups',
          'blockRules'
        ]::text[] = '{}'::jsonb
        and jsonb_typeof(content -> 'branding') = 'object'
        and jsonb_typeof(content -> 'blocks') = 'array'
        and jsonb_typeof(content -> 'layout') = 'object'
        and jsonb_typeof(content -> 'sections') = 'array'
        and jsonb_typeof(content -> 'fieldGroups') = 'array'
        and jsonb_typeof(content -> 'blockRules') = 'array'
      )
    )
  );

alter table public.documents
  add constraint documents_generated_snapshot_check
  check (
    (
      source_kind = 'upload'
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
          and template_snapshot ?& array[
            'schemaVersion',
            'branding',
            'blocks',
            'layout',
            'sections',
            'fieldGroups',
            'blockRules'
          ]
          and template_snapshot - array[
            'schemaVersion',
            'branding',
            'blocks',
            'layout',
            'sections',
            'fieldGroups',
            'blockRules'
          ]::text[] = '{}'::jsonb
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

alter table public.submissions
  add constraint submissions_template_snapshot_object
  check (
    jsonb_typeof(template_snapshot) = 'object'
    and (
      (
        template_snapshot ->> 'schemaVersion' = '2'
        and template_snapshot ?& array['schemaVersion', 'branding', 'blocks']
        and template_snapshot
          - array['schemaVersion', 'branding', 'blocks']::text[]
          = '{}'::jsonb
        and jsonb_typeof(template_snapshot -> 'branding') = 'object'
        and jsonb_typeof(template_snapshot -> 'blocks') = 'array'
      )
      or
      (
        template_snapshot ->> 'schemaVersion' = '3'
        and template_snapshot ?& array[
          'schemaVersion',
          'branding',
          'blocks',
          'layout',
          'sections',
          'fieldGroups',
          'blockRules'
        ]
        and template_snapshot - array[
          'schemaVersion',
          'branding',
          'blocks',
          'layout',
          'sections',
          'fieldGroups',
          'blockRules'
        ]::text[] = '{}'::jsonb
        and jsonb_typeof(template_snapshot -> 'branding') = 'object'
        and jsonb_typeof(template_snapshot -> 'blocks') = 'array'
        and jsonb_typeof(template_snapshot -> 'layout') = 'object'
        and jsonb_typeof(template_snapshot -> 'sections') = 'array'
        and jsonb_typeof(template_snapshot -> 'fieldGroups') = 'array'
        and jsonb_typeof(template_snapshot -> 'blockRules') = 'array'
      )
    )
  );
