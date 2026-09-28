-- Publishing keeps what was published.
--
-- A template's row is its working copy: the editor saves into it as the author
-- types, published or not. Publishing copies the row's title, description and
-- content at its revision into document_template_versions, which nothing may
-- change afterwards, and points the row at that version. Whatever uses a
-- template rather than editing it (new documents, internal submissions, public
-- forms, the library a member without templates:manage sees) reads
-- published_document_templates, which shows each published template as its
-- latest version. A restore writes an old version into the working copy, so
-- history is never rewritten.
create table public.document_template_versions (
  org_id uuid not null,
  template_id uuid not null,
  revision integer not null,
  title text not null,
  description text,
  content jsonb not null,
  published_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz not null,
  primary key (org_id, template_id, revision),
  foreign key (template_id, org_id)
    references public.document_templates (id, org_id) on delete cascade
);

alter table public.document_templates
  add column published_revision integer;

-- Until now an edit reached a published template only on Update, so each
-- published template's row is exactly what it was last published as.
insert into public.document_template_versions (
  org_id,
  template_id,
  revision,
  title,
  description,
  content,
  published_by,
  published_at
)
select org_id, id, revision, title, description, content, published_by, published_at
from public.document_templates
where published_at is not null;

-- Pointing a row at its version is not an edit; the library's order stays.
alter table public.document_templates
  disable trigger document_templates_set_updated_at;

update public.document_templates
set published_revision = revision
where published_at is not null;

alter table public.document_templates
  enable trigger document_templates_set_updated_at;

-- Deferred, because a row and its first version are written in one statement.
alter table public.document_templates
  add constraint document_templates_published_version_fkey
    foreign key (org_id, id, published_revision)
    references public.document_template_versions (org_id, template_id, revision)
    deferrable initially deferred,
  add constraint document_templates_published_has_version
    check (status <> 'published' or published_revision is not null);

-- Publishing is what moves published_at: becoming published, or Update on a
-- published template. Saving the working copy leaves it where it was.
create function public.set_document_template_published_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'published'
      and (tg_op = 'INSERT' or new.published_at is distinct from old.published_at) then
    new.published_revision := new.revision;
  end if;

  return new;
end;
$$;

create function public.record_document_template_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.published_revision = new.revision
      and (tg_op = 'INSERT' or old.published_revision is distinct from new.published_revision) then
    insert into public.document_template_versions (
      org_id,
      template_id,
      revision,
      title,
      description,
      content,
      published_by,
      published_at
    )
    values (
      new.org_id,
      new.id,
      new.revision,
      new.title,
      new.description,
      new.content,
      new.published_by,
      new.published_at
    );
  end if;

  return null;
end;
$$;

revoke all on function public.set_document_template_published_revision() from public;
revoke all on function public.record_document_template_version() from public;

create trigger document_templates_set_published_revision
  before insert or update on public.document_templates
  for each row execute function public.set_document_template_published_revision();

create trigger document_templates_record_version
  after insert or update on public.document_templates
  for each row execute function public.record_document_template_version();

alter table public.document_template_versions enable row level security;
alter table public.document_template_versions force row level security;

-- Written once by the trigger above and never changed: no update or delete.
revoke all on table public.document_template_versions
  from anon, authenticated, service_role;
grant select, insert on table public.document_template_versions to service_role;

create view public.published_document_templates
with (security_invoker = true)
as
select
  template.id,
  template.org_id,
  version.title,
  version.description,
  template.category,
  template.status,
  version.revision,
  version.content,
  template.created_by,
  template.updated_by,
  version.published_by,
  template.archived_by,
  template.created_at,
  -- For those who use a template, it changes when it is published.
  version.published_at as updated_at,
  version.published_at,
  template.archived_at,
  template.published_revision
from public.document_templates as template
join public.document_template_versions as version
  on version.org_id = template.org_id
  and version.template_id = template.id
  and version.revision = template.published_revision
where template.status = 'published';

revoke all on table public.published_document_templates
  from anon, authenticated, service_role;
grant select on table public.published_document_templates to service_role;

-- A new internal submission copies the published version, not the working copy.
create or replace function public.create_internal_submission_draft(
  target_org_id uuid,
  target_template_id uuid,
  target_submission_id uuid,
  target_title text,
  target_actor_user_id uuid
)
returns public.submissions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  published_revision integer;
  published_content jsonb;
  prepared_submission public.submissions%rowtype;
  inserted_count integer;
begin
  if target_org_id is null
      or target_template_id is null
      or target_submission_id is null
      or target_actor_user_id is null
      or target_title is null
      or target_title <> btrim(target_title)
      or char_length(target_title) not between 1 and 180 then
    raise exception 'Valid submission identifiers and title are required.'
      using errcode = '22023';
  end if;

  perform public.assert_internal_submission_actor(
    target_org_id,
    target_actor_user_id
  );

  select version.revision, version.content
  into published_revision, published_content
  from public.document_templates template_row
  join public.document_template_versions version
    on version.org_id = template_row.org_id
    and version.template_id = template_row.id
    and version.revision = template_row.published_revision
  where template_row.id = target_template_id
    and template_row.org_id = target_org_id
    and template_row.status = 'published'
  for share of template_row;

  if not found then
    raise exception 'Published submission template was not found.'
      using errcode = 'P0002';
  end if;

  insert into public.submissions (
    id,
    org_id,
    title,
    template_id,
    template_revision,
    template_snapshot,
    values,
    status,
    revision,
    created_by,
    updated_by
  )
  values (
    target_submission_id,
    target_org_id,
    target_title,
    target_template_id,
    published_revision,
    published_content,
    '{}'::jsonb,
    'draft',
    1,
    target_actor_user_id,
    target_actor_user_id
  )
  on conflict (id) do nothing
  returning * into prepared_submission;

  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    select submission.*
    into prepared_submission
    from public.submissions submission
    where submission.id = target_submission_id
    for update;

    if not found
        or prepared_submission.org_id <> target_org_id
        or prepared_submission.template_id <> target_template_id
        or prepared_submission.title <> target_title
        or prepared_submission.created_by is null
        or prepared_submission.created_by <> target_actor_user_id then
      raise exception 'Submission identifier is already in use.'
        using errcode = '23505';
    end if;

    return prepared_submission;
  end if;

  insert into public.audit_logs (
    id,
    org_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    gen_random_uuid(),
    target_org_id,
    target_actor_user_id,
    'submission.created',
    'submission',
    target_submission_id,
    jsonb_build_object(
      'templateId', target_template_id,
      'templateRevision', published_revision
    )
  );

  return prepared_submission;
end;
$$;

-- The library draws cards for members who only use templates from what was
-- published, and for authors from their working copies. A caller that does
-- not say, as before this migration, gets working copies.
drop function public.document_template_card_contents(uuid, uuid[]);

create function public.document_template_card_contents(
  target_org_id uuid,
  template_ids uuid[],
  published_only boolean default false
)
returns table (id uuid, content jsonb)
language sql
stable
set search_path = ''
as $$
  select
    template.id,
    case
      when jsonb_typeof(template.content -> 'blocks') is distinct from 'array'
        then template.content
      else jsonb_set(
        jsonb_set(
          template.content,
          '{blocks}',
          coalesce(
            (
              select jsonb_agg(
                case
                  when entry.block ->> 'type' = 'image'
                    and length(entry.block ->> 'dataUrl') > 40000
                  then jsonb_set(
                    entry.block,
                    '{dataUrl}',
                    to_jsonb(
                      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4c+0MAAUQAn+chWPSAAAAAElFTkSuQmCC'::text
                    )
                  )
                  else entry.block
                end
                order by entry.position
              )
              from jsonb_array_elements(template.content -> 'blocks')
                with ordinality as entry(block, position)
            ),
            '[]'::jsonb
          )
        ),
        '{branding,logoDataUrl}',
        case
          when length(template.content #>> '{branding,logoDataUrl}') > 40000
            then 'null'::jsonb
          else coalesce(template.content #> '{branding,logoDataUrl}', 'null'::jsonb)
        end,
        false
      )
    end
  from (
    select
      working.id,
      case when published_only then version.content else working.content end as content
    from public.document_templates as working
    left join public.document_template_versions as version
      on version.org_id = working.org_id
      and version.template_id = working.id
      and version.revision = working.published_revision
    where working.org_id = target_org_id
      and working.id = any(template_ids)
      and (not published_only or working.status = 'published')
  ) as template
  limit 100
$$;

revoke all on function public.document_template_card_contents(uuid, uuid[], boolean)
  from public, anon, authenticated;
grant execute on function public.document_template_card_contents(uuid, uuid[], boolean)
  to service_role;

notify pgrst, 'reload schema';
