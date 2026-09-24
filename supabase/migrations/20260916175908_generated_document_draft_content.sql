-- A generated document's content may be edited while it is still a draft, so
-- a document started blank can be written on its own page. Once it is sent
-- for signing, and ever after, every signer must see exactly what was sent:
-- the content is frozen as soon as the document has a recipient or leaves
-- draft. Where it came from (source, template, revision) never changes.
create or replace function public.prevent_document_snapshot_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(new.source_kind, new.template_id, new.template_revision)
      is distinct from
      row(old.source_kind, old.template_id, old.template_revision) then
    raise exception 'Generated document source snapshots are immutable.'
      using errcode = '23514';
  end if;

  if new.template_snapshot is distinct from old.template_snapshot
    and (
      old.source_kind is distinct from 'generated'
      or exists (
        select 1
        from public.document_answers answer
        where answer.document_id = old.id
          and answer.workflow_status <> 'draft'
      )
      or exists (
        select 1
        from public.document_signing_recipients recipient
        where recipient.document_id = old.id
      )
    ) then
    raise exception 'Generated document source snapshots are immutable.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;
