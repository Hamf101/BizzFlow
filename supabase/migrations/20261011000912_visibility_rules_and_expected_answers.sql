-- Visibility rules and expected answers.
--
-- 1. private.template_visible_block_ids reads every rule the editor now
--    writes, as src/types/template-visibility.ts does: one test, or two to
--    four joined by "all" or "any"; equals, not equals, answered, not
--    answered, more than and less than; a tick box, choice, typed answer or
--    date as the source. A test holds only while its source is itself shown;
--    more and less than compare doubles, as JavaScript's Number() reads them.
--    Sources always come earlier, so one pass from the first block to the
--    last answers every block once: a chain of rules with several tests on
--    the block before costs a step a block, not one a path. It returns the
--    shown blocks' ids as a jsonb object, so each lookup is one `?`.
--    private.template_block_is_visible, from its latest version in
--    20261001120000_structured_answer_kinds, keeps its signature and
--    refusals and asks it. prune_template_scalar_values and
--    validate_visible_submission_requirements (same source) ask it once per
--    call, not once per block, and find each answer's block in one join.
-- 2. merge_generated_document_answers and complete_document_recipient_signature
--    take target_expected_values, the answers a formula was worked out from.
--    Under the answer row's lock, once the visible stored answers differ from
--    them, the save is refused with 40001 and the service works the formula
--    out again from a fresh read. Without them (null, the default) nothing is
--    checked, so a caller that does not send them is unchanged. Each is
--    dropped and created again, so PostgREST sees one function, not two
--    overloads; their grants are given again as before.
--
-- `create or replace` keeps each redefined private function's grants.

create function private.template_visible_block_ids(
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
  -- What JavaScript's trim() removes, so typed answers compare as the app's do.
  edge_space constant text := '^[\s   -     　﻿]+|[\s   -     　﻿]+$';
  number_pattern constant text := '^-?[0-9]+(\.[0-9]+)?$';
  snapshot_version text;
  blocks jsonb;
  block_positions jsonb;
  -- Whether each block shows, by its place.
  shown boolean[] := array[]::boolean[];
  shown_ids text[] := array[]::text[];
  current_position integer;
  current_block jsonb;
  rule jsonb;
  conditions jsonb;
  match_any boolean;
  condition jsonb;
  test_operator text;
  expected jsonb;
  source_position integer;
  source_block jsonb;
  source_field_key text;
  answer jsonb;
  answer_text text;
  number_text text;
  number_value double precision;
  is_answered boolean;
  is_equal boolean;
  holds boolean;
  all_hold boolean;
  any_holds boolean;
  malformed boolean;
begin
  if target_template_snapshot is null
      or jsonb_typeof(target_template_snapshot) <> 'object'
      or target_values is null
      or jsonb_typeof(target_values) <> 'object'
      or jsonb_typeof(target_template_snapshot -> 'blocks') <> 'array' then
    return '{}'::jsonb;
  end if;

  snapshot_version := target_template_snapshot ->> 'schemaVersion';
  blocks := target_template_snapshot -> 'blocks';

  -- Each block's place, for ids exactly one block holds.
  select coalesce(jsonb_object_agg(block_id, block_position), '{}'::jsonb)
  into block_positions
  from (
    select entry.block ->> 'id' as block_id, min(entry.block_index)::integer as block_position
    from jsonb_array_elements(blocks) with ordinality entry(block, block_index)
    where entry.block ->> 'id' is not null
    group by entry.block ->> 'id'
    having count(*) = 1
  ) unique_blocks;

  -- A doubled id is never shown: no block answers to it alone.
  if snapshot_version = '2' then
    return (
      select coalesce(jsonb_object_agg(block_id, true), '{}'::jsonb)
      from jsonb_object_keys(block_positions) block_id
    );
  end if;

  if snapshot_version is distinct from '3' then
    return '{}'::jsonb;
  end if;

  for current_position in 1..jsonb_array_length(blocks) loop
    current_block := blocks -> (current_position - 1);
    shown[current_position] := false;

    if not current_block ? 'visibleWhen' then
      shown[current_position] := true;
      shown_ids := array_append(shown_ids, current_block ->> 'id');
      continue;
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
      continue;
    end if;

    rule := current_block -> 'visibleWhen';

    if jsonb_typeof(rule) is distinct from 'object' then
      continue;
    end if;

    if rule ? 'conditions' or rule ? 'match' then
      if not rule ?& array['match', 'conditions']
          or rule - array['match', 'conditions']::text[] <> '{}'::jsonb
          or rule -> 'match' not in ('"all"'::jsonb, '"any"'::jsonb)
          or jsonb_typeof(rule -> 'conditions') <> 'array'
          or jsonb_array_length(rule -> 'conditions') not between 2 and 4 then
        continue;
      end if;

      conditions := rule -> 'conditions';
      match_any := rule -> 'match' = '"any"'::jsonb;
    else
      conditions := jsonb_build_array(rule);
      match_any := false;
    end if;

    all_hold := true;
    any_holds := false;
    malformed := false;

    for condition in
      select entry.value
      from jsonb_array_elements(conditions) entry
    loop
      if jsonb_typeof(condition) <> 'object'
          or condition - array['sourceBlockId', 'operator', 'value']::text[]
            <> '{}'::jsonb then
        malformed := true;
        exit;
      end if;

      test_operator := condition ->> 'operator';
      expected := condition -> 'value';
      source_position := (block_positions ->> (condition ->> 'sourceBlockId'))::integer;
      source_block := blocks -> (source_position - 1);
      source_field_key := source_block ->> 'fieldKey';

      -- A source comes strictly earlier, holds a single answer, and a test
      -- carries a value exactly when it compares with one.
      if not coalesce(
          jsonb_typeof(condition -> 'sourceBlockId') = 'string'
          and jsonb_typeof(condition -> 'operator') = 'string'
          and test_operator = any(array[
            'equals', 'not_equals', 'answered', 'not_answered', 'greater_than', 'less_than'
          ])
          and (condition ? 'value') = (test_operator not in ('answered', 'not_answered'))
          and (
            expected is null
            or jsonb_typeof(expected) = 'boolean'
            or (jsonb_typeof(expected) = 'string' and char_length(expected #>> '{}') <= 240)
          )
          and (
            test_operator not in ('greater_than', 'less_than')
            or (jsonb_typeof(expected) = 'string' and expected #>> '{}' ~ number_pattern)
          )
          and source_position < current_position
          and source_block ->> 'type' = any(array[
            'checkbox_field', 'dropdown_field', 'text_field', 'date_field'
          ])
          and jsonb_typeof(source_block -> 'fieldKey') = 'string'
          and source_field_key <> ''
          and (
            source_block ->> 'type' <> 'checkbox_field'
            or jsonb_typeof(source_block -> 'checkedByDefault') = 'boolean'
          ),
          false
        ) then
        malformed := true;
        exit;
      end if;

      -- An unanswered tick box reads as its default; an unanswered list of
      -- choices as none; anything else unanswered as blank.
      answer := case
        when source_block ->> 'type' = 'checkbox_field' then
          case
            when target_values ? source_field_key
              then to_jsonb(target_values -> source_field_key = 'true'::jsonb)
            else source_block -> 'checkedByDefault'
          end
        when source_block ->> 'type' = 'dropdown_field'
            and source_block -> 'multiple' = 'true'::jsonb then
          case
            when jsonb_typeof(target_values -> source_field_key) = 'array'
              then target_values -> source_field_key
            else '[]'::jsonb
          end
        when jsonb_typeof(target_values -> source_field_key) = 'string'
          then target_values -> source_field_key
        else '""'::jsonb
      end;
      answer_text := case
        when jsonb_typeof(answer) = 'string'
          then regexp_replace(answer #>> '{}', edge_space, '', 'g')
      end;
      is_answered := case jsonb_typeof(answer)
        when 'array' then jsonb_array_length(answer) > 0
        when 'string' then answer_text <> ''
        else answer = 'true'::jsonb
      end;

      if test_operator = 'answered' then
        holds := is_answered;
      elsif test_operator = 'not_answered' then
        holds := not is_answered;
      elsif test_operator in ('greater_than', 'less_than') then
        -- A typed number, its thousands commas allowed; anything else is not
        -- one. Both sides are read as the nearest double, as Number() reads
        -- them, so the database and the app agree on every comparison.
        number_text := case
          when jsonb_typeof(answer) = 'string'
            then regexp_replace(replace(answer #>> '{}', ',', ''), edge_space, '', 'g')
          else ''
        end;

        if number_text !~ number_pattern then
          holds := false;
        else
          -- Under 300 characters a number is always within a double's range.
          if char_length(number_text) < 300 then
            number_value := number_text::double precision;
          else
            begin
              number_value := number_text::double precision;
            exception when numeric_value_out_of_range then
              -- Past a double's range Number() reads Infinity, or zero far below it.
              number_value := case
                  when number_text ~ '^-?0*(\.|$)' then 0
                  else 'Infinity'::double precision
                end
                * case when number_text like '-%' then -1 else 1 end;
            end;
          end if;

          holds := case
            when test_operator = 'greater_than'
              then number_value > (expected #>> '{}')::double precision
            else number_value < (expected #>> '{}')::double precision
          end;
        end if;
      else
        -- Equals on several choices means the value is among those ticked;
        -- typed words match whatever their case and spacing.
        is_equal := case
          when jsonb_typeof(answer) = 'array' then exists (
            select 1
            from jsonb_array_elements(answer) choice(value)
            where choice.value = expected
          )
          when jsonb_typeof(answer) = 'string' and jsonb_typeof(expected) = 'string'
            then lower(answer_text)
              = lower(regexp_replace(expected #>> '{}', edge_space, '', 'g'))
          else answer = expected
        end;
        holds := case when test_operator = 'equals' then is_equal else not is_equal end;
      end if;

      holds := shown[source_position] and coalesce(holds, false);
      all_hold := all_hold and holds;
      any_holds := any_holds or holds;
    end loop;

    shown[current_position] := not malformed
      and case when match_any then any_holds else all_hold end;

    if shown[current_position] then
      shown_ids := array_append(shown_ids, current_block ->> 'id');
    end if;
  end loop;

  return (
    select coalesce(jsonb_object_agg(shown_id, true), '{}'::jsonb)
    from unnest(shown_ids) shown_id
    where block_positions ? shown_id
  );
end;
$$;

revoke all on function private.template_visible_block_ids(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function private.template_visible_block_ids(jsonb, jsonb)
  to service_role;

create or replace function private.template_block_is_visible(
  target_template_snapshot jsonb,
  target_block_id text,
  target_values jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    private.template_visible_block_ids(target_template_snapshot, target_values)
      ? target_block_id,
    false
  )
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
  visible_block_ids jsonb;
  pruned_values jsonb;
begin
  if target_template_snapshot is null
      or jsonb_typeof(target_template_snapshot) <> 'object'
      or target_values is null
      or jsonb_typeof(target_values) <> 'object'
      or jsonb_typeof(target_template_snapshot -> 'blocks') <> 'array' then
    return '{}'::jsonb;
  end if;

  visible_block_ids := private.template_visible_block_ids(
    target_template_snapshot,
    target_values
  );

  -- An answer stays when exactly one block holds its key, that block takes a
  -- kept answer, and it shows.
  select coalesce(jsonb_object_agg(answer.key, answer.value), '{}'::jsonb)
  into pruned_values
  from jsonb_each(target_values) answer
  join (
    select
      block ->> 'fieldKey' as field_key,
      min(block ->> 'id') as block_id,
      min(block ->> 'type') as block_type
    from jsonb_array_elements(target_template_snapshot -> 'blocks') blocks(block)
    where block ->> 'fieldKey' is not null
    group by block ->> 'fieldKey'
    having count(*) = 1
  ) field on field.field_key = answer.key
  where field.block_type = any(array[
      'text_field',
      'date_field',
      'checkbox_field',
      'dropdown_field',
      'choice_grid_field',
      'table_field',
      'initials_field',
      'signature_field'
    ])
    and visible_block_ids ? field.block_id;

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
  visible_block_ids jsonb := private.template_visible_block_ids(
    target_template_snapshot,
    target_values
  );
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
      and visible_block_ids ? (block ->> 'id')
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

drop function public.merge_generated_document_answers(uuid, uuid, jsonb);

create function public.merge_generated_document_answers(
  target_org_id uuid,
  target_document_id uuid,
  target_values jsonb,
  target_expected_values jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing_values jsonb;
  existing_workflow_status text;
  document_snapshot jsonb;
  merged_values jsonb;
begin
  if target_values is null or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Document answer values must be a JSON object.'
      using errcode = '22023';
  end if;

  select answer.values, answer.workflow_status
  into existing_values, existing_workflow_status
  from public.document_answers answer
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Generated document answers were not found.'
      using errcode = 'P0002';
  end if;

  if existing_workflow_status = 'completed' then
    raise exception 'Completed document answers are immutable.'
      using errcode = '23514';
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

  -- A drawn box takes an answer only when it is the sender's, and only until
  -- the document is sent.
  if exists (
    select 1
    from jsonb_each(target_values) entry
    join jsonb_array_elements(
      coalesce(document_snapshot -> 'blocks', '[]'::jsonb)
    ) blocks(block)
      on block ->> 'fieldKey' = entry.key
    where block ->> 'type' in ('signature_field', 'initials_field')
      and block ->> 'signer' is distinct from 'sender'
  ) then
    raise exception 'Only the sender''s own box takes a drawing.'
      using errcode = '22023';
  end if;

  if exists (
      select 1
      from jsonb_each(target_values) entry
      join jsonb_array_elements(
        coalesce(document_snapshot -> 'blocks', '[]'::jsonb)
      ) blocks(block)
        on block ->> 'fieldKey' = entry.key
      where block ->> 'type' in ('signature_field', 'initials_field')
    )
    and (
      existing_workflow_status <> 'draft'
      or exists (
        select 1
        from public.document_signing_recipients recipient
        where recipient.document_id = target_document_id
          and recipient.org_id = target_org_id
      )
    ) then
    raise exception 'This document was sent for signing, so the sender''s signature can no longer change.'
      using errcode = '23514';
  end if;

  -- Persist the pre-patch prune separately so the row trigger can distinguish a
  -- genuinely re-supplied value from an unchanged, formerly hidden value.
  merged_values := private.prune_template_scalar_values(
    document_snapshot,
    existing_values
  );

  if target_expected_values is not null
      and merged_values is distinct from private.prune_template_scalar_values(
        document_snapshot,
        target_expected_values
      ) then
    raise exception 'Document answers changed since they were read.'
      using errcode = '40001';
  end if;

  if merged_values is distinct from existing_values then
    update public.document_answers answer
    set values = merged_values
    where answer.document_id = target_document_id
      and answer.org_id = target_org_id;

    existing_values := merged_values;
  end if;

  merged_values := private.prune_template_scalar_values(
    document_snapshot,
    existing_values || target_values
  );

  update public.document_answers answer
  set values = merged_values
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id
  returning answer.values into existing_values;

  return existing_values;
end;
$$;
revoke all on function public.merge_generated_document_answers(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.merge_generated_document_answers(uuid, uuid, jsonb, jsonb)
  to service_role;

drop function public.complete_document_recipient_signature(uuid, uuid, uuid, text, jsonb, jsonb, jsonb);

create function public.complete_document_recipient_signature(
  target_org_id uuid,
  target_document_id uuid,
  target_recipient_id uuid,
  target_token_hash text,
  target_values jsonb,
  target_signature_data jsonb,
  target_initials_data jsonb,
  target_expected_values jsonb default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  patch_entry record;
  answer_values jsonb;
  persisted_answer_values jsonb;
  answer_status text;
  document_snapshot jsonb;
  document_lifecycle_state public.resource_lifecycle_state;
  matching_block jsonb;
  others_signed boolean;
  merged_values jsonb;
  visible_block_ids jsonb;
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

  select document.template_snapshot, document.lifecycle_state
  into document_snapshot, document_lifecycle_state
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

  if document_lifecycle_state <> 'active' then
    raise exception 'Only active documents may be modified.'
      using errcode = 'P0001';
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

  if target_expected_values is not null
      and answer_values is distinct from private.prune_template_scalar_values(
        document_snapshot,
        target_expected_values
      ) then
    raise exception 'Document answers changed since they were read.'
      using errcode = '40001';
  end if;

  if answer_values is distinct from persisted_answer_values then
    update public.document_answers answer
    set values = answer_values
    where answer.document_id = target_document_id
      and answer.org_id = target_org_id;
  end if;

  -- Under the answer row's lock: once someone else has signed, an answer that
  -- had a value stays as they signed it. A drawn box is never an answer; each
  -- signer's drawing is kept on their own recipient row.
  others_signed := exists (
    select 1
    from public.document_signing_recipients recipient
    where recipient.document_id = target_document_id
      and recipient.org_id = target_org_id
      and recipient.id <> target_recipient_id
      and recipient.status = 'signed'
  );

  for patch_entry in
    select entry.key, entry.value
    from jsonb_each(target_values) entry
  loop
    select block
    into matching_block
    from jsonb_array_elements(
      coalesce(document_snapshot -> 'blocks', '[]'::jsonb)
    ) blocks(block)
    where block ->> 'fieldKey' = patch_entry.key
    limit 1;

    if matching_block is null
        or matching_block ->> 'type' in ('file_field', 'signature_field', 'initials_field') then
      raise exception 'Document answer % is not an answerable field.', patch_entry.key
        using errcode = '22023';
    end if;

    if not private.template_answer_has_valid_shape(matching_block, patch_entry.value) then
      raise exception 'Document answer % does not fit its field.', patch_entry.key
        using errcode = '22023';
    end if;

    if others_signed
        and coalesce(answer_values -> patch_entry.key, 'null'::jsonb) not in ('null'::jsonb, '""'::jsonb)
        and answer_values -> patch_entry.key is distinct from patch_entry.value then
      raise exception 'Someone has already signed. Send it again to change the answers.'
        using errcode = '23514';
    end if;
  end loop;

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
    visible_block_ids := private.template_visible_block_ids(
      document_snapshot,
      merged_values
    );

    for required_block in
      select block
      from jsonb_array_elements(
        coalesce(document_snapshot -> 'blocks', '[]'::jsonb)
      ) as required_blocks(block)
      where coalesce((block ->> 'required')::boolean, false)
        and block ->> 'type' not in ('signature_field', 'initials_field')
        and visible_block_ids ? (block ->> 'id')
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
revoke all on function public.complete_document_recipient_signature(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_document_recipient_signature(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb)
  to service_role;
