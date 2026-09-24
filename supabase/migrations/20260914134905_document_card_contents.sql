-- Files draws each generated document's real first page in its Icons,
-- Columns, and Gallery views. A folder of pages must not carry megabytes of
-- embedded images, so this hands the service each requested document's
-- template snapshot with every image or logo whose data URL is longer than
-- 40,000 characters swapped out, exactly as the Templates library does: an
-- image becomes a one-pixel paper-grey placeholder that still satisfies the
-- content schema, and a logo is dropped. Every block stays in place, so
-- section, field-group, and block-rule references remain valid.
--
-- Only the service role may call it; the service checks the actor's access to
-- each document and passes at most one view's worth of ids from the actor's
-- organization. Uploaded files carry no snapshot and are never returned.
create or replace function public.document_card_contents(
  target_org_id uuid,
  document_ids uuid[]
)
returns table (id uuid, content jsonb)
language sql
stable
set search_path = ''
as $$
  select
    document.id,
    case
      when jsonb_typeof(document.template_snapshot -> 'blocks') is distinct from 'array'
        then document.template_snapshot
      else jsonb_set(
        jsonb_set(
          document.template_snapshot,
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
              from jsonb_array_elements(document.template_snapshot -> 'blocks')
                with ordinality as entry(block, position)
            ),
            '[]'::jsonb
          )
        ),
        '{branding,logoDataUrl}',
        case
          when length(document.template_snapshot #>> '{branding,logoDataUrl}') > 40000
            then 'null'::jsonb
          else coalesce(document.template_snapshot #> '{branding,logoDataUrl}', 'null'::jsonb)
        end,
        false
      )
    end
  from public.documents as document
  where document.org_id = target_org_id
    and document.id = any(document_ids)
    and document.source_kind = 'generated'
    and document.template_snapshot is not null
  limit 100
$$;

revoke all on function public.document_card_contents(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.document_card_contents(uuid, uuid[])
  to service_role;

notify pgrst, 'reload schema';
