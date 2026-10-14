-- Exercises Sheets and upload conversion against a real database: a sheet row
-- and its content come together, the content has a size cap, conversion
-- tracking takes only its states, and a document's kind changes only once,
-- from an upload, in the same update that keeps its original version.
-- Creates isolated synthetic rows; any failed check rolls everything back.
do $$
<<sheets_and_conversion_test>>
declare
  owner_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  sheet_id uuid := gen_random_uuid();
  upload_id uuid := gen_random_uuid();
  other_upload_id uuid := gen_random_uuid();
  generated_id uuid := gen_random_uuid();
  upload_version_id uuid := gen_random_uuid();
  other_version_id uuid := gen_random_uuid();
  empty_sheet constant jsonb := '{"version":1,"tabs":[{"id":"t1","name":"Sheet1","cells":{}}]}';
  blank constant jsonb := '{"schemaVersion":3,"branding":{},"blocks":[],"layout":{},"sections":[],"fieldGroups":[],"blockRules":[]}';
begin
  insert into auth.users (id, email, created_at, updated_at)
  values (owner_id, 'sheets-' || replace(owner_id::text, '-', '') || '@example.invalid', now(), now());

  insert into public.profiles (id, email, full_name)
  values (owner_id, 'sheets-' || replace(owner_id::text, '-', '') || '@example.invalid', 'Sheets verification');

  insert into public.organizations (id, name, slug, created_by)
  values (organization_id, 'Sheets verification', 'sheets-' || replace(organization_id::text, '-', ''), owner_id);

  -- A sheet carries its content, and nothing else does.
  begin
    insert into public.documents (org_id, title, source_kind, created_by, updated_by)
    values (organization_id, 'No content', 'sheet', owner_id, owner_id);
    raise exception 'a sheet was stored without its content';
  exception when check_violation then null;
  end;

  begin
    insert into public.documents (org_id, title, source_kind, sheet_content, created_by, updated_by)
    values (organization_id, 'Upload with cells', 'upload', empty_sheet, owner_id, owner_id);
    raise exception 'an upload was stored with sheet content';
  exception when check_violation then null;
  end;

  begin
    insert into public.documents (org_id, title, source_kind, sheet_content, created_by, updated_by)
    values (
      organization_id, 'Too large', 'sheet',
      jsonb_build_object('version', 1, 'tabs', jsonb_build_array(jsonb_build_object(
        'id', 't1', 'name', 'Sheet1', 'cells', jsonb_build_object('A1', jsonb_build_object('v', repeat('x', 4000001)))
      ))),
      owner_id, owner_id
    );
    raise exception 'a sheet over the size cap was stored';
  exception when check_violation then null;
  end;

  insert into public.documents (id, org_id, title, source_kind, sheet_content, created_by, updated_by)
  values (sheet_id, organization_id, 'Budget', 'sheet', empty_sheet, owner_id, owner_id);

  -- Conversion tracking takes only its states, and a short reason.
  begin
    update public.documents set conversion_state = 'stuck' where id = sheet_id;
    raise exception 'an unknown conversion state was stored';
  exception when check_violation then null;
  end;

  begin
    update public.documents set conversion_error = repeat('x', 501) where id = sheet_id;
    raise exception 'an overlong conversion error was stored';
  exception when check_violation then null;
  end;

  update public.documents set conversion_state = 'done', conversion_error = null where id = sheet_id;

  insert into public.documents (id, org_id, title, source_kind, created_by, updated_by, conversion_state)
  values
    (upload_id, organization_id, 'Budget.xlsx', 'upload', owner_id, owner_id, 'pending'),
    (other_upload_id, organization_id, 'Other.xlsx', 'upload', owner_id, owner_id, null);

  insert into public.documents (id, org_id, title, source_kind, template_snapshot, created_by, updated_by)
  values (generated_id, organization_id, 'Made here', 'generated', blank, owner_id, owner_id);

  insert into public.document_versions (id, org_id, document_id, version_number, status, storage_key, original_filename, content_type, byte_size, uploaded_by)
  values
    (upload_version_id, organization_id, upload_id, 1, 'available', 'sheets-test/' || upload_version_id, 'Budget.xlsx', 'application/octet-stream', 10, owner_id),
    (other_version_id, organization_id, other_upload_id, 1, 'available', 'sheets-test/' || other_version_id, 'Other.xlsx', 'application/octet-stream', 10, owner_id);

  -- An upload becomes a sheet only while keeping its original version.
  begin
    update public.documents set source_kind = 'sheet', sheet_content = empty_sheet where id = upload_id;
    raise exception 'an upload became a sheet without keeping its original';
  exception when check_violation then null;
  end;

  -- The original must be one of its own versions.
  begin
    update public.documents
    set source_kind = 'sheet', sheet_content = empty_sheet, original_version_id = other_version_id
    where id = upload_id;
    raise exception 'an upload kept another document''s version as its original';
  exception when foreign_key_violation then null;
  end;

  -- Keeping an original without converting is refused too.
  begin
    update public.documents set original_version_id = upload_version_id where id = upload_id;
    raise exception 'an original was kept without a conversion';
  exception when check_violation then null;
  end;

  update public.documents
  set source_kind = 'sheet', sheet_content = empty_sheet, original_version_id = upload_version_id, conversion_state = 'done'
  where id = upload_id;

  -- Once only: it never changes kind again, nor lets go of its original.
  begin
    update public.documents set source_kind = 'upload', sheet_content = null where id = upload_id;
    raise exception 'a sheet went back to being an upload';
  exception when check_violation then null;
  end;

  begin
    update public.documents set source_kind = 'generated', sheet_content = null, template_snapshot = blank where id = upload_id;
    raise exception 'a converted sheet changed kind again';
  exception when check_violation then null;
  end;

  begin
    update public.documents set original_version_id = null where id = upload_id;
    raise exception 'a converted document let go of its original';
  exception when check_violation then null;
  end;

  begin
    update public.documents set source_kind = 'sheet', sheet_content = empty_sheet, template_snapshot = null where id = generated_id;
    raise exception 'a generated document became a sheet';
  exception when check_violation then null;
  end;

  begin
    update public.documents set source_kind = 'upload', sheet_content = null where id = sheet_id;
    raise exception 'a sheet became an upload';
  exception when check_violation then null;
  end;

  -- An upload may instead become a generated document, the same once-only way.
  update public.documents
  set source_kind = 'generated', template_snapshot = blank, original_version_id = other_version_id
  where id = other_upload_id;

  if (select source_kind from public.documents where id = other_upload_id) <> 'generated' then
    raise exception 'an upload did not become a generated document';
  end if;

  -- Its sheet content saves like any other change.
  update public.documents
  set sheet_content = '{"version":1,"tabs":[{"id":"t1","name":"Sheet1","cells":{"A1":{"v":1}}}]}'
  where id = sheet_id;
end
$$;
