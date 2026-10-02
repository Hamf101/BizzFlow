-- Structured answers are kept, checked and required by the database as the
-- application does. Pure functions only: nothing is written.
do $$
declare
  snapshot jsonb := jsonb_build_object(
    'schemaVersion', '3',
    'blocks', jsonb_build_array(
      jsonb_build_object('id', 'tools', 'type', 'dropdown_field', 'fieldKey', 'tools', 'label', 'Tools',
        'required', true, 'multiple', true, 'options', jsonb_build_array('Ladder', 'Drill', 'Saw')),
      jsonb_build_object('id', 'note', 'type', 'text_field', 'fieldKey', 'drill_note', 'label', 'Drill note',
        'required', false, 'visibleWhen', jsonb_build_object('sourceBlockId', 'tools', 'operator', 'equals', 'value', 'Drill')),
      jsonb_build_object('id', 'checks', 'type', 'choice_grid_field', 'fieldKey', 'checks', 'label', 'Checks',
        'required', true, 'rows', jsonb_build_array('Exits clear', 'Lights work'), 'options', jsonb_build_array('Yes', 'No')),
      jsonb_build_object('id', 'hours', 'type', 'table_field', 'fieldKey', 'hours', 'label', 'Hours',
        'required', true, 'rows', 2, 'columns', jsonb_build_array(jsonb_build_object('label', 'Day'), jsonb_build_object('label', 'Hours')))
    )
  );
  answers jsonb := '{
    "tools": ["Ladder", "Drill"],
    "drill_note": "Bring bits",
    "checks": {"Exits clear": "Yes", "Lights work": "No"},
    "hours": [["Mon", "7.5"]]
  }';
  -- Attacks go against answers whose visibility they cannot change.
  base jsonb := '{"tools": ["Ladder"], "checks": {"Exits clear": "Yes"}, "hours": []}';
  block jsonb;
begin
  -- Kept: pruning used to drop every answer to a kind it did not list.
  if private.prune_template_scalar_values(snapshot, answers) is distinct from answers then
    raise exception 'Structured answers were pruned: %', private.prune_template_scalar_values(snapshot, answers);
  end if;

  -- A ticked several-choice dropdown reveals its dependant; unticked, it hides it.
  if private.prune_template_scalar_values(snapshot, answers || '{"tools": ["Saw"]}') ? 'drill_note' then
    raise exception 'A hidden dependant of a several-choice dropdown was kept.';
  end if;

  perform public.validate_internal_submission_values(snapshot, answers);
  perform public.validate_internal_submission_values(snapshot, base);

  -- Each attack is refused.
  for block in select value from jsonb_array_elements('[
    {"tools": ["Hammer"]},
    {"tools": ["Saw", "Saw"]},
    {"tools": "Saw"},
    {"checks": {"Roof sound": "Yes"}},
    {"checks": {"__proto__": "Yes"}},
    {"checks": {"Exits clear": "Maybe"}},
    {"hours": [["Mon", "1", "extra"]]},
    {"hours": [["Mon", 1]]},
    {"hours": [["a", "1"], ["b", "2"], ["c", "3"]]}
  ]'::jsonb)
  loop
    begin
      perform public.validate_internal_submission_values(snapshot, base || block);
      raise exception 'Accepted a malformed answer: %', block using errcode = 'XX001';
    exception when sqlstate '22023' then null;
    end;
  end loop;

  begin
    perform public.validate_internal_submission_values(
      snapshot,
      base || jsonb_build_object('hours', (select jsonb_agg('["x", "1"]'::jsonb) from generate_series(1, 10000)))
    );
    raise exception 'Accepted a 10k-row table.' using errcode = 'XX001';
  exception when sqlstate '22023' then null;
  end;

  -- Required: at least one choice, every grid row, one row with something in it.
  for block in select value from jsonb_array_elements(snapshot -> 'blocks') where value ->> 'required' = 'true'
  loop
    if not private.template_answer_is_complete(block, answers -> (block ->> 'fieldKey')) then
      raise exception 'A complete % answer counted as incomplete.', block ->> 'type';
    end if;
  end loop;

  if private.template_answer_is_complete(snapshot -> 'blocks' -> 0, '[]')
      or private.template_answer_is_complete(snapshot -> 'blocks' -> 2, '{"Exits clear": "Yes"}')
      or private.template_answer_is_complete(snapshot -> 'blocks' -> 3, '[["", " "]]') then
    raise exception 'An incomplete structured answer counted as complete.';
  end if;

  -- A suggestion may now propose a structured answer.
  if not exists (
    select 1 from pg_constraint
    where conname = 'submission_answer_suggestions_value_check'
      and pg_get_constraintdef(oid) like '%array%'
  ) then
    raise exception 'Suggestions still refuse structured answers.';
  end if;
end;
$$;
