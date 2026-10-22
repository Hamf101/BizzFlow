-- Exercises fields on an uploaded PDF against a real database: they change
-- only until someone is invited; each signer fills only their own fields, and
-- every required one; an attachment must be one the signer put there; the last
-- signature completes the document, which then finalizes like a generated one.
-- Creates isolated synthetic rows inside one statement and removes them before
-- returning; any failed check rolls everything back.
do $$
<<uploaded_pdf_fields_test>>
declare
  owner_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  document_id uuid := gen_random_uuid();
  version_id uuid := gen_random_uuid();
  tenant_id uuid := gen_random_uuid();
  landlord_id uuid := gen_random_uuid();
  tenant_recipient uuid := gen_random_uuid();
  landlord_recipient uuid := gen_random_uuid();
  attachment_id uuid := gen_random_uuid();
  finalization_id uuid := gen_random_uuid();
  name_field uuid := gen_random_uuid();
  agree_field uuid := gen_random_uuid();
  sign_field uuid := gen_random_uuid();
  date_field uuid := gen_random_uuid();
  proof_field uuid := gen_random_uuid();
  tenant_hash constant text := repeat('a', 64);
  landlord_hash constant text := repeat('b', 64);
  drawing constant jsonb := '{"dataUrl":"data:image/png;base64,iVBORw0KGgo="}';
  layout jsonb;
  outcome text;
  refused boolean;
begin
  layout := jsonb_build_object(
    'signers', jsonb_build_array(
      jsonb_build_object('id', tenant_id, 'name', 'Tenant'),
      jsonb_build_object('id', landlord_id, 'name', 'Landlord')
    ),
    'fields', jsonb_build_array(
      jsonb_build_object('id', name_field, 'kind', 'text', 'signerId', tenant_id, 'required', true),
      jsonb_build_object('id', agree_field, 'kind', 'checkbox', 'signerId', tenant_id, 'required', true),
      jsonb_build_object('id', sign_field, 'kind', 'signature', 'signerId', tenant_id, 'required', true),
      jsonb_build_object('id', date_field, 'kind', 'date', 'signerId', landlord_id, 'required', true),
      jsonb_build_object('id', proof_field, 'kind', 'attachment', 'signerId', landlord_id, 'required', false)
    )
  );

  insert into auth.users (id, email, created_at, updated_at)
  values (owner_id, 'pdf-rpc-' || replace(owner_id::text, '-', '') || '@example.invalid', now(), now());
  insert into public.profiles (id, email, full_name)
  values (owner_id, 'pdf-rpc-' || replace(owner_id::text, '-', '') || '@example.invalid', 'PDF fields verification');
  insert into public.organizations (id, name, slug, created_by)
  values (organization_id, 'PDF fields verification', 'pdf-rpc-' || replace(organization_id::text, '-', ''), owner_id);
  insert into public.organization_memberships (org_id, user_id, role, status)
  select organization_id, owner_id, 'owner_admin', 'active'
  where not exists (
    select 1 from public.organization_memberships membership
    where membership.org_id = organization_id and membership.user_id = owner_id
  );

  insert into public.documents (id, org_id, title, source_kind, created_by)
  values (document_id, organization_id, 'Lease agreement', 'upload', owner_id);
  insert into public.document_versions (id, org_id, document_id, version_number, status, storage_key, original_filename, content_type, byte_size, uploaded_by)
  values (version_id, organization_id, document_id, 1, 'available', 'organizations/' || organization_id || '/documents/' || document_id || '/versions/' || version_id || '/lease.pdf', 'lease.pdf', 'application/pdf', 1024, owner_id);
  insert into public.document_answers (document_id, org_id, values, workflow_status)
  values (document_id, organization_id, '{}', 'draft');
  insert into public.document_pdf_layouts (document_id, org_id, version_id, pages, layout, updated_by)
  values (document_id, organization_id, version_id, '[{"width":612,"height":792,"rotation":0}]', '{"signers":[],"fields":[]}', owner_id);

  -- Until anyone is invited, the fields can change.
  update public.document_pdf_layouts set layout = uploaded_pdf_fields_test.layout, revision = revision + 1
  where document_pdf_layouts.document_id = uploaded_pdf_fields_test.document_id;

  -- Only someone with a signature field signs; the landlord here only dates and attaches.
  insert into public.document_signing_recipients (id, org_id, document_id, name, email, requires_signature, token_hash, token_expires_at, signer_id)
  values
    (tenant_recipient, organization_id, document_id, 'Jordan Ellis', 'jordan@example.invalid', true, tenant_hash, now() + interval '1 day', tenant_id),
    (landlord_recipient, organization_id, document_id, 'Sam Rivera', 'sam@example.invalid', false, landlord_hash, now() + interval '1 day', landlord_id);
  update public.document_answers set workflow_status = 'awaiting_signatures'
  where document_answers.document_id = uploaded_pdf_fields_test.document_id;

  begin
    update public.document_pdf_layouts set revision = revision + 1
    where document_pdf_layouts.document_id = uploaded_pdf_fields_test.document_id;
    refused := false;
  exception when check_violation then
    refused := true;
  end;
  if not refused then
    raise exception 'Fields changed after signers were invited.';
  end if;

  -- The tenant cannot fill the landlord's field, or leave their own box unticked.
  begin
    perform public.complete_pdf_recipient_signature(organization_id, document_id, tenant_recipient, tenant_hash,
      jsonb_build_object(name_field, 'Jordan Ellis', agree_field, true, date_field, '2026-09-29'), drawing, null);
    refused := false;
  exception when invalid_parameter_value then
    refused := true;
  end;
  if not refused then
    raise exception 'A signer filled someone else''s field.';
  end if;

  begin
    perform public.complete_pdf_recipient_signature(organization_id, document_id, tenant_recipient, tenant_hash,
      jsonb_build_object(name_field, 'Jordan Ellis', agree_field, false), drawing, null);
    refused := false;
  exception when invalid_parameter_value then
    refused := true;
  end;
  if not refused then
    raise exception 'A required box was left unticked.';
  end if;

  begin
    perform public.complete_pdf_recipient_signature(organization_id, document_id, tenant_recipient, tenant_hash,
      jsonb_build_object(name_field, 'Jordan Ellis', agree_field, true), null, null);
    refused := false;
  exception when invalid_parameter_value then
    refused := true;
  end;
  if not refused then
    raise exception 'A signature field was left unsigned.';
  end if;

  outcome := public.complete_pdf_recipient_signature(organization_id, document_id, tenant_recipient, tenant_hash,
    jsonb_build_object(name_field, 'Jordan Ellis', agree_field, true), drawing, null);
  if outcome <> 'awaiting_signatures' then
    raise exception 'After one of two signers, the document should still wait; it was %.', outcome;
  end if;

  -- An attachment must be the landlord's own, for that field, and uploaded.
  insert into public.document_signing_attachments (id, org_id, document_id, recipient_id, field_id, storage_key, original_filename, content_type, byte_size)
  values (attachment_id, organization_id, document_id, landlord_recipient, proof_field,
    'organizations/' || organization_id || '/documents/' || document_id || '/attachments/' || attachment_id, 'proof.pdf', 'application/pdf', 2048);

  begin
    perform public.complete_pdf_recipient_signature(organization_id, document_id, landlord_recipient, landlord_hash,
      jsonb_build_object(date_field, '2026-09-29', proof_field, attachment_id), null, null);
    refused := false;
  exception when invalid_parameter_value then
    refused := true;
  end;
  if not refused then
    raise exception 'An attachment that never finished uploading was accepted.';
  end if;

  update public.document_signing_attachments set status = 'available' where id = attachment_id;
  outcome := public.complete_pdf_recipient_signature(organization_id, document_id, landlord_recipient, landlord_hash,
    jsonb_build_object(date_field, '2026-09-29', proof_field, attachment_id), null, null);
  if outcome <> 'completed' then
    raise exception 'The last signature should complete the document; it was %.', outcome;
  end if;

  if (select values from public.document_answers where document_answers.document_id = uploaded_pdf_fields_test.document_id)
      is distinct from jsonb_build_object(name_field, 'Jordan Ellis', agree_field, true, date_field, '2026-09-29', proof_field, attachment_id) then
    raise exception 'The document does not hold both signers'' values.';
  end if;

  -- A signed upload finalizes like a generated document.
  perform public.prepare_generated_document_finalization(organization_id, document_id, finalization_id,
    'organizations/' || organization_id || '/documents/' || document_id || '/finalizations/' || finalization_id || '/final.pdf',
    repeat('c', 64), owner_id);

  -- The runner rolls the whole test back, so nothing is left behind.
end;
$$;
