-- Exercises template Trash against a real database: the shape a trashed
-- template must keep, permanent deletion and its refusals (answered, or a
-- document made from it sent to answer), that a document
-- made from the template keeps working once it is gone, and the 30-day
-- emptying of Trash. Creates isolated synthetic rows; any failed check rolls
-- everything back.
do $$
<<template_trash_test>>
declare
  owner_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  other_organization_id uuid := gen_random_uuid();
  kept_template uuid := gen_random_uuid();
  answered_template uuid := gen_random_uuid();
  old_template uuid := gen_random_uuid();
  recent_template uuid := gen_random_uuid();
  sent_template uuid := gen_random_uuid();
  sent_document_id uuid := gen_random_uuid();
  document_id uuid := gen_random_uuid();
  blank constant jsonb := '{"schemaVersion":3,"branding":{},"blocks":[],"layout":{},"sections":[],"fieldGroups":[],"blockRules":[]}';
  refusal text;
  purged integer;
begin
  insert into auth.users (id, email, created_at, updated_at)
  values (owner_id, 'trash-' || replace(owner_id::text, '-', '') || '@example.invalid', now(), now());

  insert into public.profiles (id, email, full_name)
  values (owner_id, 'trash-' || replace(owner_id::text, '-', '') || '@example.invalid', 'Template trash verification');

  insert into public.organizations (id, name, slug, created_by)
  values
    (organization_id, 'Template trash verification', 'trash-' || replace(organization_id::text, '-', ''), owner_id),
    (other_organization_id, 'Template trash other', 'trash-' || replace(other_organization_id::text, '-', ''), owner_id);

  insert into public.document_templates (id, org_id, title, status, revision, content, created_by, updated_by, published_by, published_at)
  select made.id, organization_id, made.title, 'published', 1, blank, owner_id, owner_id, owner_id, now()
  from (values
    (kept_template, 'Site visit'),
    (answered_template, 'Answered form'),
    (old_template, 'Old form'),
    (recent_template, 'Recent form'),
    (sent_template, 'Sent form')
  ) as made(id, title);

  insert into public.documents (id, org_id, title, source_kind, template_id, template_revision, template_snapshot, created_by, updated_by)
  values
    (document_id, organization_id, 'Visit on Monday', 'generated', kept_template, 1, blank, owner_id, owner_id),
    (sent_document_id, organization_id, 'Sent to answer', 'generated', sent_template, 1, blank, owner_id, owner_id);

  -- A document made from sent_template, sent to one person to answer: the link belongs to the template.
  insert into public.public_form_links (
    id, org_id, template_id, document_id, token_hash, recipient_email, content_snapshot, title_snapshot, template_revision_snapshot,
    status, max_submissions, created_by
  )
  values (
    gen_random_uuid(), organization_id, sent_template, sent_document_id, encode(sha256(gen_random_uuid()::text::bytea), 'hex'),
    'ana@example.invalid', blank, 'Sent to answer', 1, 'active', 1, owner_id
  );

  insert into public.submissions (id, org_id, title, template_id, template_revision, template_snapshot, values, status, created_by, updated_by)
  values (gen_random_uuid(), organization_id, 'A draft answer', answered_template, 1, blank, '{}', 'draft', owner_id, owner_id);

  -- A trashed template is archived and remembers what it was.
  begin
    update public.document_templates set trashed_at = now() where id = kept_template;
    raise exception 'trashed without remembering its status';
  exception when check_violation then null;
  end;

  begin
    update public.document_templates set trashed_at = now(), pre_trash_status = 'published' where id = kept_template;
    raise exception 'trashed while still published';
  exception when check_violation then null;
  end;

  update public.document_templates
  set status = 'archived', archived_at = now(), archived_by = owner_id,
      trashed_at = now(), trashed_by = owner_id, pre_trash_status = 'published'
  where id in (kept_template, answered_template, sent_template);

  update public.document_templates
  set status = 'archived', archived_at = now(), trashed_at = now() - interval '31 days', pre_trash_status = 'published'
  where id = old_template;

  update public.document_templates
  set status = 'archived', archived_at = now(), trashed_at = now() - interval '29 days', pre_trash_status = 'published'
  where id = recent_template;

  update public.document_templates set trashed_at = now() - interval '40 days' where id in (answered_template, sent_template);

  -- Everything from here runs as the app does: as the service role.
  set local role service_role;

  -- Refusals: the wrong title, a template with answers, one not in Trash, another workspace's.
  begin
    perform public.purge_trashed_document_template(organization_id, kept_template, owner_id, 'site visit');
    raise exception 'purged with the wrong title';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.purge_trashed_document_template(organization_id, answered_template, owner_id, 'Answered form');
    -- Not P0001, the refusal this block expects.
    raise exception 'purged a template people answered' using errcode = 'P0003';
  exception when sqlstate 'P0001' then null;
  end;

  begin
    perform public.purge_trashed_document_template(organization_id, sent_template, owner_id, 'Sent form');
    -- Not P0001, the refusal this block expects.
    raise exception 'purged a template whose document was sent to answer, and its link with it' using errcode = 'P0003';
  exception when sqlstate 'P0001' then null;
  end;

  update public.document_templates set trashed_at = null, trashed_by = null, pre_trash_status = null, status = 'published', archived_at = null, archived_by = null
  where id = recent_template;
  begin
    perform public.purge_trashed_document_template(organization_id, recent_template, owner_id, 'Recent form');
    raise exception 'purged a template that is not in Trash';
  exception when sqlstate 'P0002' then null;
  end;
  update public.document_templates set status = 'archived', archived_at = now(), trashed_at = now() - interval '29 days', pre_trash_status = 'published'
  where id = recent_template;

  begin
    perform public.purge_trashed_document_template(other_organization_id, kept_template, owner_id, 'Site visit');
    raise exception 'purged another workspace''s template';
  exception when sqlstate 'P0002' then null;
  end;

  if not exists (select 1 from public.document_templates where id = kept_template) then
    raise exception 'a refused purge removed the template';
  end if;

  -- The real thing: the template goes, its document stays and still has its content.
  perform public.purge_trashed_document_template(organization_id, kept_template, owner_id, 'Site visit');

  if exists (select 1 from public.document_templates where id = kept_template)
      or exists (select 1 from public.document_template_versions where template_id = kept_template) then
    raise exception 'the template or its versions outlived permanent deletion';
  end if;

  if not exists (
    select 1 from public.documents
    where id = document_id and template_id is null and template_revision is null and template_snapshot = blank
  ) then
    raise exception 'the document made from the template did not survive on its own';
  end if;

  if not exists (
    select 1 from public.audit_logs
    where org_id = organization_id and action = 'template.purged' and target_id = kept_template and actor_user_id = owner_id
  ) then
    raise exception 'permanent deletion was not audited';
  end if;

  -- Emptying Trash takes what has been there 30 days, never what people answered.
  purged := public.purge_due_trashed_document_templates(100);

  if purged < 1 or exists (select 1 from public.document_templates where id = old_template) then
    raise exception 'a template 31 days in Trash was not deleted';
  end if;

  if not exists (select 1 from public.document_templates where id = recent_template)
      or not exists (select 1 from public.document_templates where id = answered_template)
      or not exists (select 1 from public.public_form_links link where link.document_id = sent_document_id) then
    raise exception 'emptying Trash took a recent or answered template, or a sent document''s link';
  end if;

  if not exists (
    select 1 from public.audit_logs
    where org_id = organization_id and action = 'template.purged' and target_id = old_template and actor_user_id is null
  ) then
    raise exception 'emptying Trash was not audited';
  end if;

  reset role;

  -- A signed-in member cannot call either function.
  foreach refusal in array array[
    'public.purge_trashed_document_template(uuid,uuid,uuid,text)',
    'public.purge_due_trashed_document_templates(integer)'
  ] loop
    if has_function_privilege('authenticated', refusal, 'execute') or has_function_privilege('anon', refusal, 'execute') then
      raise exception '% is open to signed-in members', refusal;
    end if;
  end loop;
end;
$$;
