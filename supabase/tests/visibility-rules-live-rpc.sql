-- The database shows and hides a block as src/types/template-visibility.ts
-- does: one test or two to four joined by all or any, every operator, tick
-- box, choice, typed and date sources, a hidden source failing its test, and a
-- long chain of rules answered in one pass. Pure functions only: nothing is
-- written.
do $$
declare
  sources jsonb := jsonb_build_array(
    jsonb_build_object('id', 'pets', 'type', 'checkbox_field', 'fieldKey', 'pets', 'label', 'Pets', 'required', false, 'checkedByDefault', false),
    jsonb_build_object('id', 'consent', 'type', 'checkbox_field', 'fieldKey', 'consent', 'label', 'Consent', 'required', false, 'checkedByDefault', true),
    jsonb_build_object('id', 'income', 'type', 'text_field', 'fieldKey', 'income', 'label', 'Income', 'required', false, 'format', 'number'),
    jsonb_build_object('id', 'name', 'type', 'text_field', 'fieldKey', 'name', 'label', 'Name', 'required', false),
    jsonb_build_object('id', 'start', 'type', 'date_field', 'fieldKey', 'start', 'label', 'Start', 'required', false),
    jsonb_build_object('id', 'status', 'type', 'dropdown_field', 'fieldKey', 'status', 'label', 'Status', 'required', false,
      'multiple', false, 'options', jsonb_build_array('Employed', 'Retired')),
    jsonb_build_object('id', 'tools', 'type', 'dropdown_field', 'fieldKey', 'tools', 'label', 'Tools', 'required', false,
      'multiple', true, 'options', jsonb_build_array('Ladder', 'Drill', 'Saw')),
    -- Shown only while Pets is ticked, so a test on it fails while it is hidden.
    jsonb_build_object('id', 'vet', 'type', 'text_field', 'fieldKey', 'vet', 'label', 'Vet', 'required', false,
      'visibleWhen', jsonb_build_object('sourceBlockId', 'pets', 'operator', 'equals', 'value', true)),
    jsonb_build_object('id', 'upload', 'type', 'file_field', 'fieldKey', 'upload', 'label', 'Upload', 'required', false)
  );
  -- [rule of block "t", answers, whether "t" shows]
  cases jsonb := '[
    [{"sourceBlockId": "pets", "operator": "equals", "value": true}, {}, false],
    [{"sourceBlockId": "pets", "operator": "equals", "value": true}, {"pets": true}, true],
    [{"sourceBlockId": "pets", "operator": "not_equals", "value": true}, {}, true],
    [{"sourceBlockId": "pets", "operator": "equals", "value": true}, {"pets": "true"}, false],
    [{"sourceBlockId": "consent", "operator": "equals", "value": true}, {}, true],
    [{"sourceBlockId": "consent", "operator": "equals", "value": true}, {"consent": false}, false],
    [{"sourceBlockId": "pets", "operator": "answered"}, {"pets": true}, true],
    [{"sourceBlockId": "pets", "operator": "not_answered"}, {}, true],

    [{"sourceBlockId": "name", "operator": "answered"}, {"name": " \t "}, false],
    [{"sourceBlockId": "name", "operator": "answered"}, {"name": " Al "}, true],
    [{"sourceBlockId": "name", "operator": "not_answered"}, {}, true],
    [{"sourceBlockId": "name", "operator": "not_answered"}, {"name": "Al"}, false],
    [{"sourceBlockId": "name", "operator": "equals", "value": "Alice"}, {"name": "  aLiCe "}, true],
    [{"sourceBlockId": "name", "operator": "equals", "value": "Alice"}, {"name": "Alicia"}, false],
    [{"sourceBlockId": "name", "operator": "not_equals", "value": "Alice"}, {"name": "ALICE"}, false],
    [{"sourceBlockId": "name", "operator": "not_equals", "value": "Alice"}, {}, true],

    [{"sourceBlockId": "income", "operator": "greater_than", "value": "50000"}, {"income": "50,270"}, true],
    [{"sourceBlockId": "income", "operator": "greater_than", "value": "50000"}, {"income": " 1,000,000.50 "}, true],
    [{"sourceBlockId": "income", "operator": "greater_than", "value": "50000"}, {"income": "49,999.5"}, false],
    [{"sourceBlockId": "income", "operator": "greater_than", "value": "50000"}, {"income": "50000"}, false],
    [{"sourceBlockId": "income", "operator": "less_than", "value": "50000"}, {"income": "-3"}, true],
    [{"sourceBlockId": "income", "operator": "less_than", "value": "50000"}, {"income": "lots"}, false],
    [{"sourceBlockId": "income", "operator": "less_than", "value": "50000"}, {"income": "1e3"}, false],
    [{"sourceBlockId": "income", "operator": "less_than", "value": "50000"}, {}, false],
    [{"sourceBlockId": "income", "operator": "greater_than", "value": "-1.5"}, {"income": "-1.25"}, true],

    [{"sourceBlockId": "start", "operator": "equals", "value": "2026-10-10"}, {"start": "2026-10-10"}, true],
    [{"sourceBlockId": "start", "operator": "not_equals", "value": "2026-10-10"}, {"start": "2026-10-11"}, true],
    [{"sourceBlockId": "start", "operator": "answered"}, {}, false],

    [{"sourceBlockId": "status", "operator": "equals", "value": "Retired"}, {"status": "retired"}, true],
    [{"sourceBlockId": "status", "operator": "not_equals", "value": "Retired"}, {}, true],
    [{"sourceBlockId": "tools", "operator": "equals", "value": "Drill"}, {"tools": ["Ladder", "Drill"]}, true],
    [{"sourceBlockId": "tools", "operator": "equals", "value": "Drill"}, {"tools": ["drill"]}, false],
    [{"sourceBlockId": "tools", "operator": "not_equals", "value": "Drill"}, {"tools": ["Saw"]}, true],
    [{"sourceBlockId": "tools", "operator": "answered"}, {"tools": []}, false],
    [{"sourceBlockId": "tools", "operator": "answered"}, {"tools": "Saw"}, false],

    [{"match": "all", "conditions": [
      {"sourceBlockId": "pets", "operator": "equals", "value": true},
      {"sourceBlockId": "income", "operator": "greater_than", "value": "100"}]}, {"pets": true, "income": "50"}, false],
    [{"match": "all", "conditions": [
      {"sourceBlockId": "pets", "operator": "equals", "value": true},
      {"sourceBlockId": "income", "operator": "greater_than", "value": "100"}]}, {"pets": true, "income": "150"}, true],
    [{"match": "any", "conditions": [
      {"sourceBlockId": "pets", "operator": "equals", "value": true},
      {"sourceBlockId": "status", "operator": "equals", "value": "Retired"},
      {"sourceBlockId": "name", "operator": "answered"}]}, {"status": "Retired"}, true],
    [{"match": "any", "conditions": [
      {"sourceBlockId": "pets", "operator": "equals", "value": true},
      {"sourceBlockId": "status", "operator": "equals", "value": "Retired"}]}, {"status": "Employed"}, false],

    [{"sourceBlockId": "vet", "operator": "answered"}, {"vet": "Dr Lee"}, false],
    [{"sourceBlockId": "vet", "operator": "not_answered"}, {}, false],
    [{"sourceBlockId": "vet", "operator": "answered"}, {"pets": true, "vet": "Dr Lee"}, true],
    [{"match": "any", "conditions": [
      {"sourceBlockId": "vet", "operator": "not_answered"},
      {"sourceBlockId": "name", "operator": "answered"}]}, {}, false],

    [{"sourceBlockId": "pets", "operator": "contains", "value": true}, {"pets": true}, false],
    [{"sourceBlockId": "pets", "operator": "answered", "value": true}, {"pets": true}, false],
    [{"sourceBlockId": "name", "operator": "equals"}, {}, false],
    [{"sourceBlockId": "income", "operator": "greater_than", "value": "lots"}, {"income": "5"}, false],
    [{"sourceBlockId": "name", "operator": "answered", "extra": 1}, {"name": "Al"}, false],
    [{"sourceBlockId": "upload", "operator": "answered"}, {"upload": "x"}, false],
    [{"sourceBlockId": "later", "operator": "answered"}, {"later": "x"}, false],
    [{"sourceBlockId": "t", "operator": "answered"}, {"t": "x"}, false],
    [{"match": "all", "conditions": [{"sourceBlockId": "name", "operator": "answered"}]}, {"name": "Al"}, false],
    [{"match": "some", "conditions": [
      {"sourceBlockId": "name", "operator": "answered"},
      {"sourceBlockId": "pets", "operator": "answered"}]}, {"name": "Al"}, false]
  ]';
  test jsonb;
  snapshot jsonb;
  chain jsonb := '[]';
  started timestamptz;
begin
  for test in select value from jsonb_array_elements(cases)
  loop
    snapshot := jsonb_build_object('schemaVersion', '3', 'blocks', sources || jsonb_build_array(
      jsonb_build_object('id', 't', 'type', 'text_field', 'fieldKey', 't', 'label', 'T', 'required', false, 'visibleWhen', test -> 0),
      jsonb_build_object('id', 'later', 'type', 'text_field', 'fieldKey', 'later', 'label', 'Later', 'required', false)
    ));

    if private.template_block_is_visible(snapshot, 't', test -> 1) is distinct from (test ->> 2)::boolean then
      raise exception 'Rule % with answers % should show: %', test -> 0, test -> 1, test ->> 2;
    end if;
  end loop;

  -- Pruning keeps what an "any" rule shows and drops what it hides.
  snapshot := jsonb_build_object('schemaVersion', '3', 'blocks', sources || jsonb_build_array(
    jsonb_build_object('id', 't', 'type', 'text_field', 'fieldKey', 't', 'label', 'T', 'required', false,
      'visibleWhen', cases -> 37 -> 0)
  ));
  if not private.prune_template_scalar_values(snapshot, '{"status": "Retired", "t": "kept"}') ? 't'
      or private.prune_template_scalar_values(snapshot, '{"status": "Employed", "t": "dropped"}') ? 't' then
    raise exception 'Pruning does not follow an "any" rule.';
  end if;

  -- Version two shows everything; an unknown version or a doubled id nothing.
  if not private.template_block_is_visible(jsonb_set(snapshot, '{schemaVersion}', '"2"'), 't', '{}')
      or private.template_block_is_visible(jsonb_set(snapshot, '{schemaVersion}', '"4"'), 'name', '{}')
      or private.template_block_is_visible(
        jsonb_set(snapshot, '{blocks}', (snapshot -> 'blocks') || jsonb_build_array(snapshot -> 'blocks' -> 3)), 'name', '{}') then
    raise exception 'The snapshot version or a doubled block id was not respected.';
  end if;

  -- Each block shows when the one before it is answered and is not "no": a
  -- walk that re-asks every source would take 2^300 steps.
  chain := jsonb_build_array(jsonb_build_object('id', 'b0', 'type', 'text_field', 'fieldKey', 'b0', 'label', 'B0', 'required', false));
  for i in 1..300 loop
    chain := chain || jsonb_build_array(jsonb_build_object(
      'id', 'b' || i, 'type', 'text_field', 'fieldKey', 'b' || i, 'label', 'B' || i, 'required', false,
      'visibleWhen', jsonb_build_object('match', 'all', 'conditions', jsonb_build_array(
        jsonb_build_object('sourceBlockId', 'b' || (i - 1), 'operator', 'answered'),
        jsonb_build_object('sourceBlockId', 'b' || (i - 1), 'operator', 'not_equals', 'value', 'no')
      ))
    ));
  end loop;
  snapshot := jsonb_build_object('schemaVersion', '3', 'blocks', chain);
  started := clock_timestamp();

  if not private.template_block_is_visible(snapshot, 'b300', (select jsonb_object_agg('b' || i, 'yes') from generate_series(0, 300) i))
      or private.template_block_is_visible(snapshot, 'b300', (select jsonb_object_agg('b' || i, case when i = 150 then 'No' else 'yes' end) from generate_series(0, 300) i)) then
    raise exception 'A long chain of rules was answered wrongly.';
  end if;

  if clock_timestamp() - started > interval '2 seconds' then
    raise exception 'A long chain of rules took %.', clock_timestamp() - started;
  end if;
end;
$$;
