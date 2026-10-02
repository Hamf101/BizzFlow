-- Structured answer kinds: several ticked choices, a choice grid and a table.
--
-- A dropdown_field with "multiple" stores the options ticked (a JSON array),
-- a choice_grid_field stores each answered row's choice (an object keyed by
-- row text) and a table_field stores its rows (an array of arrays of cell
-- text). Until now the database knew only text and ticks: pruning dropped any
-- answer to a field kind it did not list, so grid and table answers would have
-- vanished on every save, and required checks treated a list as incomplete.
--
-- This redefines, from their latest versions in
-- 20260912202419_reconcile_template_visibility_and_role_protection, the five
-- functions that keep, check and require answers, and widens the suggestion
-- value check. `create or replace` keeps each function's grants; their
-- security settings and search_path are unchanged. Typed text formats (number,
-- money, email and so on) are checked by the application, as dates and
-- drawings already were in part; the database guards each answer's shape.
-- There is no data statement: no stored answer has a structured shape yet.

-- Whether a stored answer has the shape its field kind holds. Lists and
-- records are checked whole: ticked choices are distinct options, a grid names
-- its own rows and options, and a table keeps within its rows, one cell a
-- column and 500 characters a cell. Every other kind but a tick is text.
create function private.template_answer_has_valid_shape(
  target_block jsonb,
  target_value jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when target_block ->> 'type' = 'checkbox_field' then
      jsonb_typeof(target_value) = 'boolean'
    when target_block ->> 'type' = 'dropdown_field'
        and target_block -> 'multiple' = 'true'::jsonb then
      case
        when jsonb_typeof(target_value) is distinct from 'array' then false
        else not exists (
            select 1
            from jsonb_array_elements(target_value) choice(value)
            where not coalesce(
              (target_block -> 'options') @> jsonb_build_array(choice.value),
              false
            )
          )
          and jsonb_array_length(target_value) = (
            select count(distinct choice.value)
            from jsonb_array_elements(target_value) choice(value)
          )
      end
    when target_block ->> 'type' = 'choice_grid_field' then
      case
        when jsonb_typeof(target_value) is distinct from 'object' then false
        else not exists (
          select 1
          from jsonb_each(target_value) entry
          where not coalesce((target_block -> 'rows') ? entry.key, false)
            or not coalesce(
              (target_block -> 'options') @> jsonb_build_array(entry.value),
              false
            )
        )
      end
    when target_block ->> 'type' = 'table_field' then
      case
        when jsonb_typeof(target_value) is distinct from 'array' then false
        when jsonb_array_length(target_value) > case
            when target_block -> 'addRows' = 'true'::jsonb then 100
            else coalesce((target_block ->> 'rows')::integer, 0)
          end then false
        else not exists (
          select 1
          from jsonb_array_elements(target_value) table_row(value)
          where case
            when jsonb_typeof(table_row.value) <> 'array' then true
            else jsonb_array_length(table_row.value)
                is distinct from jsonb_array_length(target_block -> 'columns')
              or exists (
                select 1
                from jsonb_array_elements(table_row.value) cell(value)
                where jsonb_typeof(cell.value) <> 'string'
                  or char_length(cell.value #>> '{}') > 500
              )
          end
        )
      end
    else jsonb_typeof(target_value) = 'string'
  end
$$;

-- Whether a required field's answer counts as given: a tick, at least one
-- choice, every grid row, at least one table row with something in it, or
-- any text.
create function private.template_answer_is_complete(
  target_block jsonb,
  target_value jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when target_value is null then false
    when target_block ->> 'type' = 'checkbox_field' then
      target_value = 'true'::jsonb
    when target_block ->> 'type' = 'choice_grid_field' then
      case
        when jsonb_typeof(target_value) <> 'object' then false
        else not exists (
          select 1
          from jsonb_array_elements_text(
            coalesce(target_block -> 'rows', '[]'::jsonb)
          ) grid_row(label)
          where jsonb_typeof(target_value -> grid_row.label) is distinct from 'string'
            or btrim(target_value ->> grid_row.label) = ''
        )
      end
    when target_block ->> 'type' = 'table_field' then
      case
        when jsonb_typeof(target_value) <> 'array' then false
        else exists (
          select 1
          from jsonb_array_elements(target_value) table_row(value)
          where case
            when jsonb_typeof(table_row.value) <> 'array' then false
            else exists (
              select 1
              from jsonb_array_elements_text(table_row.value) cell(value)
              where btrim(cell.value) <> ''
            )
          end
        )
      end
    when jsonb_typeof(target_value) = 'array' then
      jsonb_array_length(target_value) > 0
    else jsonb_typeof(target_value) = 'string'
      and btrim(target_value #>> '{}') <> ''
  end
$$;

revoke all on function private.template_answer_has_valid_shape(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function private.template_answer_is_complete(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function private.template_answer_has_valid_shape(jsonb, jsonb)
  to service_role;
grant execute on function private.template_answer_is_complete(jsonb, jsonb)
  to service_role;

create or replace function private.template_block_is_visible(
  target_template_snapshot jsonb,
  target_block_id text,
  target_values jsonb
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  snapshot_version text;
  current_block_id text := target_block_id;
  current_block jsonb;
  current_block_index bigint;
  current_match_count integer;
  condition jsonb;
  source_block_id text;
  source_block jsonb;
  source_block_index bigint;
  source_match_count integer;
  source_field_key text;
  effective_source_value jsonb;
  expected_source_value jsonb;
  visited_block_ids text[] := array[]::text[];
begin
  if target_template_snapshot is null
      or jsonb_typeof(target_template_snapshot) <> 'object'
      or target_values is null
      or jsonb_typeof(target_values) <> 'object'
      or target_block_id is null
      or target_block_id = ''
      or jsonb_typeof(target_template_snapshot -> 'blocks') <> 'array' then
    return false;
  end if;

  snapshot_version := target_template_snapshot ->> 'schemaVersion';

  select count(*)
  into current_match_count
  from jsonb_array_elements(
    target_template_snapshot -> 'blocks'
  ) with ordinality blocks(block, block_index)
  where block ->> 'id' = current_block_id;

  if current_match_count <> 1 then
    return false;
  end if;

  select block, block_index
  into current_block, current_block_index
  from jsonb_array_elements(
    target_template_snapshot -> 'blocks'
  ) with ordinality blocks(block, block_index)
  where block ->> 'id' = current_block_id;

  if snapshot_version = '2' then
    return true;
  end if;

  if snapshot_version is distinct from '3' then
    return false;
  end if;

  loop
    if current_block_id = any(visited_block_ids) then
      return false;
    end if;

    visited_block_ids := array_append(visited_block_ids, current_block_id);

    if not current_block ? 'visibleWhen' then
      return true;
    end if;

    if not coalesce(
      current_block ->> 'type' = any(array[
        'text_field',
        'date_field',
        'checkbox_field',
        'dropdown_field',
        'choice_grid_field',
        'table_field',
        'initials_field',
        'signature_field',
        'file_field'
      ]),
      false
    ) then
      return false;
    end if;

    condition := current_block -> 'visibleWhen';

    if jsonb_typeof(condition) <> 'object'
        or not condition ?& array['sourceBlockId', 'operator', 'value']
        or condition - array['sourceBlockId', 'operator', 'value']::text[]
          <> '{}'::jsonb
        or jsonb_typeof(condition -> 'sourceBlockId') <> 'string'
        or jsonb_typeof(condition -> 'operator') <> 'string'
        or condition ->> 'operator' <> 'equals' then
      return false;
    end if;

    source_block_id := condition ->> 'sourceBlockId';
    expected_source_value := condition -> 'value';

    if source_block_id is null or source_block_id = '' then
      return false;
    end if;

    select count(*)
    into source_match_count
    from jsonb_array_elements(
      target_template_snapshot -> 'blocks'
    ) with ordinality blocks(block, block_index)
    where block ->> 'id' = source_block_id;

    if source_match_count <> 1 then
      return false;
    end if;

    select block, block_index
    into source_block, source_block_index
    from jsonb_array_elements(
      target_template_snapshot -> 'blocks'
    ) with ordinality blocks(block, block_index)
    where block ->> 'id' = source_block_id;

    if source_block_index >= current_block_index
        or source_block_id = current_block_id
        or not coalesce(
          source_block ->> 'type' = any(array[
            'checkbox_field',
            'dropdown_field'
          ]),
          false
        )
        or jsonb_typeof(source_block -> 'fieldKey') is distinct from 'string' then
      return false;
    end if;

    source_field_key := source_block ->> 'fieldKey';

    if source_field_key is null or source_field_key = '' then
      return false;
    end if;

    if source_block ->> 'type' = 'checkbox_field' then
      if jsonb_typeof(expected_source_value) is distinct from 'boolean'
          or jsonb_typeof(source_block -> 'checkedByDefault') is distinct from 'boolean' then
        return false;
      end if;

      if target_values ? source_field_key then
        effective_source_value := case
          when jsonb_typeof(target_values -> source_field_key) = 'boolean'
            then target_values -> source_field_key
          else 'false'::jsonb
        end;
      else
        effective_source_value := source_block -> 'checkedByDefault';
      end if;
    else
      if jsonb_typeof(expected_source_value) is distinct from 'string'
          or jsonb_typeof(source_block -> 'options') is distinct from 'array'
          or not exists (
            select 1
            from jsonb_array_elements(source_block -> 'options') option(value)
            where option.value = expected_source_value
          ) then
        return false;
      end if;

      -- Equals on a several-choice dropdown means the value is among those ticked.
      effective_source_value := case
        when source_block -> 'multiple' = 'true'::jsonb then
          case
            when jsonb_typeof(target_values -> source_field_key) = 'array'
              and (target_values -> source_field_key) @> jsonb_build_array(expected_source_value)
              then expected_source_value
            else '""'::jsonb
          end
        when target_values ? source_field_key
          and jsonb_typeof(target_values -> source_field_key) = 'string'
          then target_values -> source_field_key
        else '""'::jsonb
      end;
    end if;

    if effective_source_value is distinct from expected_source_value then
      return false;
    end if;

    current_block_id := source_block_id;
    current_block := source_block;
    current_block_index := source_block_index;
  end loop;
end;
$$;

create or replace function private.prune_template_scalar_values(
  target_template_snapshot jsonb,
  target_values jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  answer record;
  matching_block jsonb;
  matching_block_count integer;
  pruned_values jsonb := '{}'::jsonb;
begin
  if target_template_snapshot is null
      or jsonb_typeof(target_template_snapshot) <> 'object'
      or target_values is null
      or jsonb_typeof(target_values) <> 'object'
      or jsonb_typeof(target_template_snapshot -> 'blocks') <> 'array' then
    return pruned_values;
  end if;

  for answer in
    select entry.key, entry.value
    from jsonb_each(target_values) entry
  loop
    select count(*)
    into matching_block_count
    from jsonb_array_elements(
      target_template_snapshot -> 'blocks'
    ) blocks(block)
    where block ->> 'fieldKey' = answer.key;

    if matching_block_count <> 1 then
      continue;
    end if;

    select block
    into matching_block
    from jsonb_array_elements(
      target_template_snapshot -> 'blocks'
    ) blocks(block)
    where block ->> 'fieldKey' = answer.key;

    if not coalesce(
        matching_block ->> 'type' = any(array[
          'text_field',
          'date_field',
          'checkbox_field',
          'dropdown_field',
          'choice_grid_field',
          'table_field',
          'initials_field',
          'signature_field'
        ]),
        false
      )
        or not private.template_block_is_visible(
          target_template_snapshot,
          matching_block ->> 'id',
          target_values
        ) then
      continue;
    end if;

    pruned_values := pruned_values || jsonb_build_object(
      answer.key,
      answer.value
    );
  end loop;

  return pruned_values;
end;
$$;

create or replace function private.validate_visible_submission_requirements(
  target_template_snapshot jsonb,
  target_values jsonb,
  target_submission_id uuid,
  target_org_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  required_block jsonb;
  required_field_key text;
  required_value jsonb;
begin
  for required_block in
    select block
    from jsonb_array_elements(
      coalesce(target_template_snapshot -> 'blocks', '[]'::jsonb)
    ) blocks(block)
    where coalesce((block ->> 'required')::boolean, false)
      and private.template_block_is_visible(
        target_template_snapshot,
        block ->> 'id',
        target_values
      )
  loop
    required_field_key := required_block ->> 'fieldKey';

    if required_field_key is null or required_field_key = '' then
      raise exception 'Submission snapshot contains an invalid required field.'
        using errcode = '23514';
    end if;

    if required_block ->> 'type' = 'file_field' then
      if not exists (
        select 1
        from public.submission_files submission_file
        where submission_file.submission_id = target_submission_id
          and submission_file.org_id = target_org_id
          and submission_file.field_key = required_field_key
          and submission_file.status = 'available'
      ) then
        raise exception 'Required submission file % is missing.', required_block ->> 'label'
          using errcode = '22023';
      end if;

      continue;
    end if;

    if not coalesce(
      required_block ->> 'type' = any(array[
        'text_field',
        'date_field',
        'checkbox_field',
        'dropdown_field',
        'choice_grid_field',
        'table_field',
        'initials_field',
        'signature_field'
      ]),
      false
    ) then
      raise exception 'Submission snapshot contains an invalid required field.'
        using errcode = '23514';
    end if;

    required_value := target_values -> required_field_key;

    if not private.template_answer_is_complete(required_block, required_value) then
      raise exception 'Required submission field % is incomplete.', required_block ->> 'label'
        using errcode = '22023';
    end if;
  end loop;
end;
$$;

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
  visible_scalar_values jsonb;
begin
  if target_values is null or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Submission values must be a JSON object.'
      using errcode = '22023';
  end if;

  visible_scalar_values := private.prune_template_scalar_values(
    target_template_snapshot,
    target_values
  );

  if visible_scalar_values is distinct from target_values then
    raise exception 'Submission values contain a hidden, unknown, duplicated, or file field.'
      using errcode = '22023';
  end if;

  for answer in
    select entry.key, entry.value
    from jsonb_each(target_values) entry
  loop
    select block
    into matching_block
    from jsonb_array_elements(
      coalesce(target_template_snapshot -> 'blocks', '[]'::jsonb)
    ) blocks(block)
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

    if not private.template_answer_has_valid_shape(matching_block, answer.value) then
      raise exception 'Submission field % does not fit its field.', answer.key
        using errcode = '22023';
    end if;

    -- Lists and records were checked whole just now; the rules below are for text.
    if jsonb_typeof(answer.value) <> 'string' then
      continue;
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

create or replace function public.complete_document_recipient_signature(
  target_org_id uuid,
  target_document_id uuid,
  target_recipient_id uuid,
  target_token_hash text,
  target_values jsonb,
  target_signature_data jsonb,
  target_initials_data jsonb
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  answer_values jsonb;
  persisted_answer_values jsonb;
  answer_status text;
  document_snapshot jsonb;
  merged_values jsonb;
  required_block jsonb;
  required_field_key text;
  recipient_requires_signature boolean;
  recipient_status text;
  recipient_token_expires_at timestamptz;
begin
  select answer.values, answer.workflow_status
  into answer_values, answer_status
  from public.document_answers answer
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Generated document answers were not found.'
      using errcode = 'P0002';
  end if;

  if target_values is null or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Document answer values must be a JSON object.'
      using errcode = '22023';
  end if;

  select document.template_snapshot
  into document_snapshot
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
    and document.source_kind = 'generated';

  if not found then
    raise exception 'Generated document snapshot was not found.'
      using errcode = 'P0002';
  end if;

  select recipient.requires_signature, recipient.status, recipient.token_expires_at
  into recipient_requires_signature, recipient_status, recipient_token_expires_at
  from public.document_signing_recipients recipient
  where recipient.id = target_recipient_id
    and recipient.document_id = target_document_id
    and recipient.org_id = target_org_id
    and recipient.token_hash = target_token_hash
  for update;

  if not found then
    raise exception 'Document signing recipient was not found.'
      using errcode = 'P0002';
  end if;

  if recipient_status = 'signed' then
    return answer_status;
  end if;

  if recipient_token_expires_at <= now() then
    raise exception 'Document signing token has expired.'
      using errcode = 'P0001';
  end if;

  if answer_status = 'completed' then
    raise exception 'Completed document answers are immutable.'
      using errcode = '23514';
  end if;

  if recipient_requires_signature and target_signature_data is null then
    raise exception 'A drawn signature is required.'
      using errcode = '22023';
  end if;

  persisted_answer_values := answer_values;
  answer_values := private.prune_template_scalar_values(
    document_snapshot,
    answer_values
  );

  if answer_values is distinct from persisted_answer_values then
    update public.document_answers answer
    set values = answer_values
    where answer.document_id = target_document_id
      and answer.org_id = target_org_id;
  end if;

  merged_values := private.prune_template_scalar_values(
    document_snapshot,
    answer_values || target_values
  );

  if not exists (
    select 1
    from public.document_signing_recipients recipient
    where recipient.document_id = target_document_id
      and recipient.org_id = target_org_id
      and recipient.id <> target_recipient_id
      and recipient.requires_signature
      and recipient.status <> 'signed'
  ) then
    for required_block in
      select block
      from jsonb_array_elements(
        coalesce(document_snapshot -> 'blocks', '[]'::jsonb)
      ) as required_blocks(block)
      where coalesce((block ->> 'required')::boolean, false)
        and block ->> 'type' not in ('signature_field', 'initials_field')
        and private.template_block_is_visible(
          document_snapshot,
          block ->> 'id',
          merged_values
        )
    loop
      required_field_key := required_block ->> 'fieldKey';

      if required_field_key is null or required_field_key = '' then
        raise exception 'Generated document snapshot contains an invalid required field.'
          using errcode = '23514';
      end if;

      if not private.template_answer_is_complete(
        required_block,
        merged_values -> required_field_key
      ) then
        raise exception 'Required document fields must be completed before the final signature.'
          using errcode = '22023';
      end if;
    end loop;
  end if;

  update public.document_signing_recipients recipient
  set status = 'signed',
      viewed_at = coalesce(recipient.viewed_at, now()),
      signed_at = now(),
      signature_data = target_signature_data,
      initials_data = target_initials_data
  where recipient.id = target_recipient_id
    and recipient.document_id = target_document_id
    and recipient.org_id = target_org_id;

  if exists (
    select 1
    from public.document_signing_recipients recipient
    where recipient.document_id = target_document_id
      and recipient.org_id = target_org_id
      and recipient.requires_signature
      and recipient.status <> 'signed'
  ) then
    answer_status := 'awaiting_signatures';
  else
    answer_status := 'completed';
  end if;

  update public.document_answers answer
  set values = merged_values,
      workflow_status = answer_status
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id;

  return answer_status;
end;
$$;

alter table public.submission_answer_suggestions
  drop constraint submission_answer_suggestions_value_check,
  add constraint submission_answer_suggestions_value_check
    check (jsonb_typeof(proposed_value) in ('string', 'boolean', 'array', 'object'));
