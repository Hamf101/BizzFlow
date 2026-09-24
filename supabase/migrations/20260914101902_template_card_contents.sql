-- The Templates library draws each template's real first page on its card.
-- A page of cards must not carry megabytes of embedded images, so this hands
-- the service each requested template's content with every image or logo
-- whose data URL is longer than 40,000 characters swapped out: an image
-- becomes a one-pixel paper-grey placeholder that still satisfies the content
-- schema, and a logo is dropped. Every block stays in place, so section,
-- field-group, and block-rule references remain valid.
--
-- Only the service role may call it; the service checks the actor's access
-- and passes one page of template ids from the actor's organization.
create or replace function public.document_template_card_contents(
  target_org_id uuid,
  template_ids uuid[]
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
  from public.document_templates as template
  where template.org_id = target_org_id
    and template.id = any(template_ids)
  limit 100
$$;

revoke all on function public.document_template_card_contents(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.document_template_card_contents(uuid, uuid[])
  to service_role;

notify pgrst, 'reload schema';
