-- A save that worked an answer out from the answers it read is refused once
-- someone else has changed them, so a total never sums a stale part: both
-- merge_generated_document_answers and complete_document_recipient_signature
-- refuse a stale expected base with 40001 and change nothing, take a matching
-- one, and still take a call without one. Creates isolated synthetic rows
-- inside one statement; any failed check rolls everything back.
do $$
<<expected_base_test>>
declare
  owner_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  document_id uuid := gen_random_uuid();
  signer_id uuid := gen_random_uuid();
  signer_token text := encode(sha256('expected-base-token'::bytea), 'hex');
  drawing jsonb := '{"dataUrl": "data:image/png;base64,iVBORw0KGgo="}';
  snapshot jsonb := jsonb_build_object(
    'schemaVersion', '3',
    'branding', '{}'::jsonb,
    'layout', '{}'::jsonb,
    'sections', '[]'::jsonb,
    'fieldGroups', '[]'::jsonb,
    'blockRules', '[]'::jsonb,
    'blocks', jsonb_build_array(
      jsonb_build_object('id', 'a', 'type', 'text_field', 'fieldKey', 'a', 'label', 'A', 'required', false),
      jsonb_build_object('id', 'b', 'type', 'text_field', 'fieldKey', 'b', 'label', 'B', 'required', false),
      jsonb_build_object('id', 'total', 'type', 'text_field', 'fieldKey', 'total', 'label', 'Total', 'required', false)
    )
  );
  first_read jsonb := '{"a": "1", "b": "1", "total": "2"}';
begin
  insert into auth.users (id, email, created_at, updated_at)
  values (owner_id, 'rpc-' || replace(owner_id::text, '-', '') || '@example.invalid', now(), now());

  insert into public.profiles (id, email, full_name)
  values (owner_id, 'rpc-' || replace(owner_id::text, '-', '') || '@example.invalid', 'Expected base verification');

  insert into public.organizations (id, name, slug, created_by)
  values (organization_id, 'Expected base verification', 'base-rpc-' || replace(organization_id::text, '-', ''), owner_id);

  insert into public.documents (id, org_id, title, source_kind, template_snapshot, created_by, updated_by)
  values (document_id, organization_id, 'Expected base', 'generated', snapshot, owner_id, owner_id);

  -- A key no field holds is never compared: the database drops it anyway.
  insert into public.document_answers (document_id, org_id, values, workflow_status)
  values (document_id, organization_id, first_read || '{"retired": "x"}', 'draft');

  -- Two people read A = 1, B = 1. The first saves A = 2, Total = 3.
  perform public.merge_generated_document_answers(
    target_org_id => organization_id,
    target_document_id => document_id,
    target_values => '{"a": "2", "total": "3"}',
    target_expected_values => first_read
  );

  -- The second, still holding what they read, is refused and changes nothing.
  begin
    perform public.merge_generated_document_answers(
      target_org_id => organization_id,
      target_document_id => document_id,
      target_values => '{"b": "3", "total": "4"}',
      target_expected_values => first_read
    );
    raise exception 'A save from stale answers was taken.' using errcode = 'XX001';
  exception when sqlstate '40001' then null;
  end;

  if (select values from public.document_answers answer where answer.document_id = expected_base_test.document_id)
      is distinct from '{"a": "2", "b": "1", "total": "3"}'::jsonb then
    raise exception 'A refused save changed the answers.';
  end if;

  -- Read again, they save; a caller that sends no base is not checked.
  perform public.merge_generated_document_answers(
    target_org_id => organization_id,
    target_document_id => document_id,
    target_values => '{"b": "3", "total": "5"}',
    target_expected_values => '{"a": "2", "b": "1", "total": "3"}'
  );
  perform public.merge_generated_document_answers(
    target_org_id => organization_id,
    target_document_id => document_id,
    target_values => '{"a": "2"}'
  );

  update public.document_answers answer
  set workflow_status = 'awaiting_signatures'
  where answer.document_id = expected_base_test.document_id;

  insert into public.document_signing_recipients (id, org_id, document_id, name, email, token_hash, token_expires_at)
  values (signer_id, organization_id, document_id, 'Signer', 'signer@example.invalid', signer_token, now() + interval '1 day');

  begin
    perform public.complete_document_recipient_signature(
      target_org_id => organization_id,
      target_document_id => document_id,
      target_recipient_id => signer_id,
      target_token_hash => signer_token,
      target_values => '{"a": "4", "total": "7"}',
      target_signature_data => drawing,
      target_initials_data => null,
      target_expected_values => first_read
    );
    raise exception 'A signature from stale answers was taken.' using errcode = 'XX001';
  exception when sqlstate '40001' then null;
  end;

  if (select status from public.document_signing_recipients where id = signer_id) <> 'pending' then
    raise exception 'A refused signature was recorded.';
  end if;

  perform public.complete_document_recipient_signature(
    target_org_id => organization_id,
    target_document_id => document_id,
    target_recipient_id => signer_id,
    target_token_hash => signer_token,
    target_values => '{"a": "4", "total": "7"}',
    target_signature_data => drawing,
    target_initials_data => null,
    target_expected_values => '{"a": "2", "b": "3", "total": "5"}'
  );

  if (select values from public.document_answers answer where answer.document_id = expected_base_test.document_id)
      is distinct from '{"a": "4", "b": "3", "total": "7"}'::jsonb then
    raise exception 'A signature from current answers was not saved.';
  end if;
end;
$$;
