create or replace function public.validate_internal_submission_values(
  target_template_snapshot jsonb,
  target_values jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  answer record;
  matching_block jsonb;
  answer_text text;
begin
  if target_values is null or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Submission values must be a JSON object.'
      using errcode = '22023';
  end if;

  for answer in
    select entry.key, entry.value
    from jsonb_each(target_values) entry
  loop
    select block
    into matching_block
    from (
      select jsonb_array_elements(
        coalesce(target_template_snapshot #> '{sections,header,blocks}', '[]'::jsonb)
      ) as block
      union all
      select jsonb_array_elements(
        coalesce(target_template_snapshot #> '{sections,body,blocks}', '[]'::jsonb)
      ) as block
      union all
      select jsonb_array_elements(
        coalesce(target_template_snapshot #> '{sections,footer,blocks}', '[]'::jsonb)
      ) as block
    ) blocks
    where block ->> 'fieldKey' = answer.key
    limit 1;

    if matching_block is null
        or matching_block ->> 'type' = 'file_field' then
      raise exception 'Submission value % is not a scalar field in this snapshot.', answer.key
        using errcode = '22023';
    end if;

    if matching_block ->> 'type' = 'checkbox_field' then
      if jsonb_typeof(answer.value) <> 'boolean' then
        raise exception 'Submission field % must be a boolean.', answer.key
          using errcode = '22023';
      end if;

      continue;
    end if;

    if jsonb_typeof(answer.value) <> 'string' then
      raise exception 'Submission field % must be text.', answer.key
        using errcode = '22023';
    end if;

    answer_text := answer.value #>> '{}';

    if matching_block ->> 'type' in ('signature_field', 'initials_field') then
      if char_length(answer_text) > 2800000
          or (
            answer_text <> ''
            and answer_text !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$'
          ) then
        raise exception 'Submission drawing field % is invalid.', answer.key
          using errcode = '22023';
      end if;

      continue;
    end if;

    if char_length(answer_text) > 20000 then
      raise exception 'Submission field % is too long.', answer.key
        using errcode = '22023';
    end if;

    if matching_block ->> 'type' = 'date_field'
        and answer_text <> ''
        and (
          answer_text !~ '^\d{4}-\d{2}-\d{2}$'
          or to_char(to_date(answer_text, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> answer_text
        ) then
      raise exception 'Submission field % must be a valid date.', answer.key
        using errcode = '22023';
    end if;

    if matching_block ->> 'type' = 'dropdown_field'
        and answer_text <> ''
        and not coalesce((matching_block -> 'options') ? answer_text, false) then
      raise exception 'Submission field % must use an available option.', answer.key
        using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function public.validate_internal_submission_values(jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function public.validate_internal_submission_values(jsonb, jsonb)
  to service_role;

notify pgrst, 'reload schema';
