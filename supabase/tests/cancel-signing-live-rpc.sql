-- A sender may take back a document awaiting signatures: cancel_document_signing
-- returns it to a draft and revokes every signer, a signed one's evidence
-- included, which is kept and may change no further. Its page may then change,
-- while only revoked signers remain; a live signer, or a completed document,
-- still freezes it. A revoked link signs nothing, the same address may be sent
-- the document again, and the new round completes without the revoked signers.
-- Creates isolated synthetic rows inside one statement; any failed check rolls
-- everything back.
do $$
<<cancel_signing_test>>
declare
  owner_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  document_id uuid := gen_random_uuid();
  first_id uuid := gen_random_uuid();
  second_id uuid := gen_random_uuid();
  again_id uuid := gen_random_uuid();
  first_token text := encode(sha256('cancel-first-token'::bytea), 'hex');
  second_token text := encode(sha256('cancel-second-token'::bytea), 'hex');
  again_token text := encode(sha256('cancel-again-token'::bytea), 'hex');
  drawing jsonb := '{"dataUrl": "data:image/png;base64,iVBORw0KGgo="}';
  snapshot jsonb := jsonb_build_object(
    'schemaVersion', '3',
    'branding', '{}'::jsonb,
    'layout', '{}'::jsonb,
    'sections', '[]'::jsonb,
    'fieldGroups', '[]'::jsonb,
    'blockRules', '[]'::jsonb,
    'blocks', jsonb_build_array(
      jsonb_build_object('id', 'name', 'type', 'text_field', 'fieldKey', 'client_name', 'label', 'Client', 'required', false)
    )
  );
  -- A valid page that differs, so only the freeze can refuse it.
  changed jsonb := jsonb_set(snapshot, '{blocks,0,label}', '"Client name"');
  revoked_count integer;
begin
  insert into auth.users (id, email, created_at, updated_at)
  values (owner_id, 'rpc-' || replace(owner_id::text, '-', '') || '@example.invalid', now(), now());

  insert into public.profiles (id, email, full_name)
  values (owner_id, 'rpc-' || replace(owner_id::text, '-', '') || '@example.invalid', 'Cancel signing verification');

  insert into public.organizations (id, name, slug, created_by)
  values (organization_id, 'Cancel signing verification', 'cancel-rpc-' || replace(organization_id::text, '-', ''), owner_id);

  insert into public.documents (id, org_id, title, source_kind, template_snapshot, created_by, updated_by)
  values (document_id, organization_id, 'Cancel signing', 'generated', snapshot, owner_id, owner_id);

  insert into public.document_answers (document_id, org_id, values, workflow_status)
  values (document_id, organization_id, '{"client_name": "Acme"}', 'awaiting_signatures');

  insert into public.document_signing_recipients (id, org_id, document_id, name, email, token_hash, token_expires_at)
  values
    (first_id, organization_id, document_id, 'First', 'first@example.invalid', first_token, now() + interval '1 day'),
    (second_id, organization_id, document_id, 'Second', 'second@example.invalid', second_token, now() + interval '1 day');

  perform public.complete_document_recipient_signature(
    organization_id, document_id, first_id, first_token, '{}', drawing, null
  );

  -- A live signer freezes the page.
  begin
    update public.documents document
    set template_snapshot = changed
    where document.id = cancel_signing_test.document_id;
    raise exception 'A sent page changed.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;

  select count(*) into revoked_count
  from public.cancel_document_signing(organization_id, document_id);

  if revoked_count <> 2
      or (select workflow_status from public.document_answers answer where answer.document_id = cancel_signing_test.document_id) <> 'draft'
      or exists (
        select 1 from public.document_signing_recipients recipient
        where recipient.document_id = cancel_signing_test.document_id and recipient.revoked_at is null
      ) then
    raise exception 'Cancelling did not return the document to a draft with every signer revoked.';
  end if;

  if (select signature_data from public.document_signing_recipients where id = first_id) is distinct from drawing then
    raise exception 'A revoked signature was not kept as evidence.';
  end if;

  -- A revoked signed row changes no further.
  begin
    update public.document_signing_recipients set revoked_at = null where id = first_id;
    raise exception 'A revoked signer was restored.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;

  -- With only revoked signers, the page may change.
  update public.documents document
  set template_snapshot = changed
  where document.id = cancel_signing_test.document_id;

  -- A draft cannot be cancelled again.
  begin
    perform public.cancel_document_signing(organization_id, document_id);
    raise exception 'A draft was cancelled.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;

  -- A revoked link signs nothing.
  begin
    perform public.complete_document_recipient_signature(
      organization_id, document_id, second_id, second_token, '{}', drawing, null
    );
    raise exception 'A revoked link signed.' using errcode = 'XX001';
  exception when sqlstate 'P0002' then null;
  end;

  -- Sent again, to an address already in the cancelled round.
  update public.document_answers answer
  set workflow_status = 'awaiting_signatures'
  where answer.document_id = cancel_signing_test.document_id;

  insert into public.document_signing_recipients (id, org_id, document_id, name, email, token_hash, token_expires_at)
  values (again_id, organization_id, document_id, 'Second', 'second@example.invalid', again_token, now() + interval '1 day');

  -- A live signer freezes the page again.
  begin
    update public.documents document
    set template_snapshot = snapshot
    where document.id = cancel_signing_test.document_id;
    raise exception 'A re-sent page changed.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;

  -- The one live signer completes it; the revoked unsigned one waits for nothing.
  if public.complete_document_recipient_signature(
      organization_id, document_id, again_id, again_token, '{}', drawing, null
    ) <> 'completed' then
    raise exception 'The new round did not complete without its revoked signers.';
  end if;

  -- A completed document can be neither cancelled nor changed.
  begin
    perform public.cancel_document_signing(organization_id, document_id);
    raise exception 'A completed document was cancelled.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;

  begin
    update public.documents document
    set template_snapshot = snapshot
    where document.id = cancel_signing_test.document_id;
    raise exception 'A completed page changed.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;
end;
$$;
