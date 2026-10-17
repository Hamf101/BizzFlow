-- A signer consents to signing electronically, and the address they signed
-- from is kept with their signature, for the completion certificate. A call
-- made before consent was asked (no consent given either way) still signs, so
-- code from before this change keeps working; an explicit "no" signs nothing.
-- A signer may decline instead, with a reason: the document goes back to a
-- draft with every link revoked, as a cancel does, and an earlier signer's
-- evidence stays. An empty reason, or a signer who has signed, declines nothing.
-- Creates isolated synthetic rows inside one statement; any failed check rolls
-- everything back.
do $$
<<consent_decline_test>>
declare
  owner_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  document_id uuid := gen_random_uuid();
  first_id uuid := gen_random_uuid();
  second_id uuid := gen_random_uuid();
  third_id uuid := gen_random_uuid();
  first_token text := encode(sha256('consent-first-token'::bytea), 'hex');
  second_token text := encode(sha256('consent-second-token'::bytea), 'hex');
  third_token text := encode(sha256('consent-third-token'::bytea), 'hex');
  drawing jsonb := '{"dataUrl": "data:image/png;base64,iVBORw0KGgo="}';
  snapshot jsonb := jsonb_build_object(
    'schemaVersion', '3',
    'branding', '{}'::jsonb,
    'layout', '{}'::jsonb,
    'sections', '[]'::jsonb,
    'fieldGroups', '[]'::jsonb,
    'blockRules', '[]'::jsonb,
    'blocks', '[]'::jsonb
  );
  revoked_count integer;
  first_row record;
  third_row record;
begin
  insert into auth.users (id, email, created_at, updated_at)
  values (owner_id, 'rpc-' || replace(owner_id::text, '-', '') || '@example.invalid', now(), now());

  insert into public.profiles (id, email, full_name)
  values (owner_id, 'rpc-' || replace(owner_id::text, '-', '') || '@example.invalid', 'Consent and decline verification');

  insert into public.organizations (id, name, slug, created_by)
  values (organization_id, 'Consent and decline verification', 'consent-rpc-' || replace(organization_id::text, '-', ''), owner_id);

  insert into public.documents (id, org_id, title, source_kind, template_snapshot, created_by, updated_by)
  values (document_id, organization_id, 'Consent and decline', 'generated', snapshot, owner_id, owner_id);

  insert into public.document_answers (document_id, org_id, values, workflow_status)
  values (document_id, organization_id, '{}', 'awaiting_signatures');

  insert into public.document_signing_recipients (id, org_id, document_id, name, email, token_hash, token_expires_at)
  values
    (first_id, organization_id, document_id, 'First', 'first@example.invalid', first_token, now() + interval '1 day'),
    (second_id, organization_id, document_id, 'Second', 'second@example.invalid', second_token, now() + interval '1 day'),
    (third_id, organization_id, document_id, 'Third', 'third@example.invalid', third_token, now() + interval '1 day');

  -- An explicit "no" to signing electronically signs nothing.
  begin
    perform public.complete_document_recipient_signature(
      organization_id, document_id, first_id, first_token, '{}', drawing, null, null, false, '203.0.113.7'
    );
    raise exception 'A signer who did not consent signed.' using errcode = 'XX001';
  exception when sqlstate '22023' then null;
  end;

  -- Consent and address are kept with the signature.
  perform public.complete_document_recipient_signature(
    organization_id, document_id, first_id, first_token, '{}', drawing, null, null, true, '203.0.113.7'
  );

  select status, consented_at, signed_ip into first_row
  from public.document_signing_recipients recipient
  where recipient.id = consent_decline_test.first_id;

  if first_row.status <> 'signed' or first_row.consented_at is null or first_row.signed_ip <> '203.0.113.7' then
    raise exception 'Signing did not keep the consent and the address it was made from.';
  end if;

  -- A call from before consent was asked still signs, and records no consent.
  perform public.complete_document_recipient_signature(
    organization_id, document_id, third_id, third_token, '{}', drawing, null
  );

  select status, consented_at, signed_ip into third_row
  from public.document_signing_recipients recipient
  where recipient.id = consent_decline_test.third_id;

  if third_row.status <> 'signed' or third_row.consented_at is not null or third_row.signed_ip is not null then
    raise exception 'A call from before consent was asked did not sign as it used to.';
  end if;

  -- An empty reason declines nothing; nor does a signer who has signed.
  begin
    perform public.decline_document_signing(organization_id, document_id, second_id, second_token, '   ');
    raise exception 'A decline without a reason was kept.' using errcode = 'XX001';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.decline_document_signing(organization_id, document_id, first_id, first_token, 'Changed my mind');
    raise exception 'A signer who had signed declined.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;

  select count(*) into revoked_count
  from public.decline_document_signing(organization_id, document_id, second_id, second_token, '  The price is wrong.  ');

  if revoked_count <> 3
      or (select workflow_status from public.document_answers answer where answer.document_id = consent_decline_test.document_id) <> 'draft'
      or exists (
        select 1 from public.document_signing_recipients recipient
        where recipient.document_id = consent_decline_test.document_id and recipient.revoked_at is null
      )
      or not exists (
        select 1 from public.document_signing_recipients recipient
        where recipient.id = consent_decline_test.second_id
          and recipient.status = 'declined'
          and recipient.declined_at is not null
          and recipient.decline_reason = 'The price is wrong.'
      )
      or not exists (
        select 1 from public.document_signing_recipients recipient
        where recipient.id = consent_decline_test.first_id and recipient.status = 'signed' and recipient.signed_ip = '203.0.113.7'
      ) then
    raise exception 'Declining did not return the document to a draft, revoke every link, keep the reason, and keep the earlier signature.';
  end if;

  -- A revoked link, the decliner's own included, declines nothing more.
  begin
    perform public.decline_document_signing(organization_id, document_id, second_id, second_token, 'Again');
    raise exception 'A revoked link declined.' using errcode = 'XX001';
  exception when sqlstate 'P0002' then null;
  end;
end;
$$;
