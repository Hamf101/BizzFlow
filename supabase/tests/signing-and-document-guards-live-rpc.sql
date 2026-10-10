-- Exercises the signing and generated-document guards against a real
-- database: a member may draw only in the sender's box and only before the
-- document is sent, signers are numbered in the order they were added, a
-- signer cannot answer a drawn box, an unknown field, or a field
-- with the wrong shape, nor change an answer someone else has signed, nor sign
-- an archived document; a generated document takes no uploaded version, and
-- once finalized keeps its finalized PDF as current; a pending finalization
-- from other input is discarded, a finalized one never, and the sweep lists
-- only completed documents with no finalized PDF. Creates isolated
-- synthetic rows inside one statement and removes them before returning; any
-- failed check rolls everything back.
do $$
<<signing_guards_test>>
declare
  owner_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  document_id uuid := gen_random_uuid();
  first_id uuid := gen_random_uuid();
  second_id uuid := gen_random_uuid();
  finalization_id uuid := gen_random_uuid();
  stale_id uuid := gen_random_uuid();
  first_token text := encode(sha256('first-token'::bytea), 'hex');
  second_token text := encode(sha256('second-token'::bytea), 'hex');
  drawing jsonb := '{"dataUrl": "data:image/png;base64,iVBORw0KGgo="}';
  snapshot jsonb := jsonb_build_object(
    'schemaVersion', '3',
    'branding', '{}'::jsonb,
    'layout', '{}'::jsonb,
    'sections', '[]'::jsonb,
    'fieldGroups', '[]'::jsonb,
    'blockRules', '[]'::jsonb,
    'blocks', jsonb_build_array(
      jsonb_build_object('id', 'name', 'type', 'text_field', 'fieldKey', 'client_name', 'label', 'Client', 'required', true),
      jsonb_build_object('id', 'note', 'type', 'text_field', 'fieldKey', 'note', 'label', 'Note', 'required', false),
      jsonb_build_object('id', 'agreed', 'type', 'checkbox_field', 'fieldKey', 'agreed', 'label', 'Agreed', 'required', false),
      jsonb_build_object('id', 'initials', 'type', 'initials_field', 'fieldKey', 'client_initials', 'label', 'Initials', 'required', false),
      jsonb_build_object('id', 'sender', 'type', 'signature_field', 'fieldKey', 'sender_signature', 'label', 'Sender', 'required', false, 'signer', 'sender')
    )
  );
  sender_drawing text := 'data:image/png;base64,U2VuZGVy';
  attack jsonb;
  version_id uuid;
begin
  insert into auth.users (id, email, created_at, updated_at)
  values (owner_id, 'rpc-' || replace(owner_id::text, '-', '') || '@example.invalid', now(), now());

  insert into public.profiles (id, email, full_name)
  values (owner_id, 'rpc-' || replace(owner_id::text, '-', '') || '@example.invalid', 'Signing guards verification');

  insert into public.organizations (id, name, slug, created_by)
  values (organization_id, 'Signing guards verification', 'sign-rpc-' || replace(organization_id::text, '-', ''), owner_id);

  insert into public.documents (id, org_id, title, source_kind, template_snapshot, created_by, updated_by)
  values (document_id, organization_id, 'Signing guards', 'generated', snapshot, owner_id, owner_id);

  insert into public.document_answers (document_id, org_id, values, workflow_status)
  values (document_id, organization_id, '{"client_name": "As agreed"}', 'draft');

  -- Before sending, the sender draws in their own box and in no signer's.
  perform public.merge_generated_document_answers(
    organization_id, document_id, jsonb_build_object('sender_signature', sender_drawing)
  );

  begin
    perform public.merge_generated_document_answers(
      organization_id, document_id, '{"client_initials": "data:image/png;base64,iVBORw0KGgo="}'
    );
    raise exception 'A member drew in a signer''s box.' using errcode = 'XX001';
  exception when sqlstate '22023' then null;
  end;

  update public.document_answers answer
  set workflow_status = 'awaiting_signatures'
  where answer.document_id = signing_guards_test.document_id;

  insert into public.document_signing_recipients (id, org_id, document_id, name, email, token_hash, token_expires_at)
  values
    (first_id, organization_id, document_id, 'First', 'first@example.invalid', first_token, now() + interval '1 day'),
    (second_id, organization_id, document_id, 'Second', 'second@example.invalid', second_token, now() + interval '1 day');

  if (select array_agg(recipient.id order by recipient.signer_number) from public.document_signing_recipients recipient
      where recipient.document_id = signing_guards_test.document_id) is distinct from array[first_id, second_id] then
    raise exception 'Signers were not numbered in the order they were added.';
  end if;

  -- Once sent, the sender's box is frozen.
  begin
    perform public.merge_generated_document_answers(
      organization_id, document_id, '{"sender_signature": "data:image/png;base64,iVBORw0KGgo="}'
    );
    raise exception 'The sender redrew after sending.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;

  -- A drawn box, a field the document lacks, or an answer of the wrong shape.
  for attack in select value from jsonb_array_elements('[
    {"client_initials": "data:image/png;base64,iVBORw0KGgo="},
    {"sender_signature": "data:image/png;base64,iVBORw0KGgo="},
    {"forged": "x"},
    {"agreed": "yes"}
  ]'::jsonb)
  loop
    begin
      perform public.complete_document_recipient_signature(
        organization_id, document_id, first_id, first_token, attack, drawing, null
      );
      raise exception 'A signer was allowed to answer %.', attack using errcode = 'XX001';
    exception when sqlstate '22023' then null;
    end;
  end loop;

  if (select status from public.document_signing_recipients where id = first_id) <> 'pending' then
    raise exception 'A refused signature was recorded.';
  end if;

  -- Before anyone signs, a signer may still correct an answer.
  perform public.complete_document_recipient_signature(
    organization_id, document_id, first_id, first_token, '{"client_name": "Corrected"}', drawing, null
  );

  -- After that, what was signed stands; an empty field may still be filled.
  begin
    perform public.complete_document_recipient_signature(
      organization_id, document_id, second_id, second_token, '{"client_name": "Rewritten"}', drawing, null
    );
    raise exception 'A later signer rewrote a signed answer.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;

  -- An archived document takes no signature.
  update public.documents
  set lifecycle_state = 'archived', archived_by = owner_id, archived_at = now()
  where id = document_id;

  begin
    perform public.complete_document_recipient_signature(
      organization_id, document_id, second_id, second_token, '{"note": "Late"}', drawing, null
    );
    raise exception 'An archived document took a signature.' using errcode = 'XX001';
  exception when sqlstate 'P0001' then null;
  end;

  update public.documents
  set lifecycle_state = 'active', archived_by = null, archived_at = null
  where id = document_id;

  if public.complete_document_recipient_signature(
    organization_id, document_id, second_id, second_token, '{"client_name": "Corrected", "note": "Added"}', drawing, null
  ) <> 'completed' then
    raise exception 'The last signer did not complete the document.';
  end if;

  if (select values from public.document_answers answer where answer.document_id = signing_guards_test.document_id)
      is distinct from jsonb_build_object('client_name', 'Corrected', 'note', 'Added', 'sender_signature', sender_drawing) then
    raise exception 'Signed answers were not kept as signed.';
  end if;

  -- A generated document takes no uploaded version, by the RPC or directly.
  begin
    perform public.create_pending_document_version(
      organization_id, document_id, gen_random_uuid(),
      'organizations/' || organization_id || '/documents/' || document_id || '/versions/x/original.pdf',
      'forged.pdf', 'application/pdf', 10, null, owner_id, now() + interval '15 minutes'
    );
    raise exception 'A generated document took an uploaded version.' using errcode = 'XX001';
  exception when sqlstate 'P0001' then null;
  end;

  begin
    insert into public.document_versions (id, org_id, document_id, version_number, status, storage_key, original_filename, content_type, byte_size, uploaded_by)
    values (gen_random_uuid(), organization_id, document_id, 1, 'available', 'organizations/forged.pdf', 'forged.pdf', 'application/pdf', 10, owner_id);
    raise exception 'A generated document took an inserted version.' using errcode = 'XX001';
  exception when sqlstate 'P0001' then null;
  end;

  -- A completed document with no finalized PDF is listed for the sweep, and a
  -- pending attempt prepared from other input is discarded, not refused.
  insert into public.generated_document_finalizations (id, org_id, document_id, storage_key, render_input_sha256, created_by)
  values (stale_id, organization_id, document_id,
    'organizations/' || organization_id || '/documents/' || document_id || '/finalizations/' || stale_id || '/final.pdf',
    repeat('c', 64), owner_id);

  if not exists (select 1 from public.list_unfinalized_generated_documents(100) listed where listed.document_id = signing_guards_test.document_id) then
    raise exception 'A completed, unfinalized document was not listed.';
  end if;

  -- Finalization still promotes its PDF, which then stays current.
  perform public.prepare_generated_document_finalization(
    organization_id, document_id, finalization_id,
    'organizations/' || organization_id || '/documents/' || document_id || '/finalizations/' || finalization_id || '/final.pdf',
    repeat('a', 64), owner_id
  );
  version_id := public.promote_generated_document_finalization(
    organization_id, document_id, finalization_id, repeat('b', 64), 100, 'Signing-guards-final.pdf', owner_id
  );

  if (select current_version_id from public.documents where id = document_id) is distinct from version_id then
    raise exception 'Finalization did not promote its PDF.';
  end if;

  if exists (select 1 from public.generated_document_finalizations where id = stale_id)
      or exists (select 1 from public.list_unfinalized_generated_documents(100) listed where listed.document_id = signing_guards_test.document_id) then
    raise exception 'A stale attempt survived, or a finalized document was listed.';
  end if;

  -- A finalized row is never discarded or changed, whatever input asks.
  begin
    perform public.prepare_generated_document_finalization(
      organization_id, document_id, stale_id,
      'organizations/' || organization_id || '/documents/' || document_id || '/finalizations/' || stale_id || '/final.pdf',
      repeat('c', 64), owner_id
    );
    raise exception 'A finalized document was prepared again.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;

  if (select finalization.render_input_sha256 from public.generated_document_finalizations finalization where finalization.document_id = signing_guards_test.document_id and finalization.status = 'finalized') <> repeat('a', 64) then
    raise exception 'A finalized document changed.';
  end if;

  begin
    update public.documents set current_version_id = null where id = document_id;
    raise exception 'A finalized document lost its finalized version.' using errcode = 'XX001';
  exception when sqlstate 'P0001' then null;
  end;

  delete from public.organizations
  where id = organization_id;

  delete from auth.users
  where id = owner_id;
end;
$$;
