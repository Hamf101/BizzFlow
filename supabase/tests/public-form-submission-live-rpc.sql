-- Exercises submit_public_form_entry against a real database: a link's
-- capacity is used only when a submission is saved, a draft is guarded by its
-- revision, and the ceiling holds. Creates isolated synthetic rows inside one
-- statement and removes them before returning; any failed check rolls
-- everything back.
do $$
<<public_submission_test>>
declare
  owner_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  template_id uuid := gen_random_uuid();
  other_template_id uuid := gen_random_uuid();
  link_id uuid := gen_random_uuid();
  draft_id uuid := gen_random_uuid();
  link_token text := 'live-rpc-' || replace(gen_random_uuid()::text, '-', '');
  draft_token text := md5(random()::text) || md5(random()::text);
  template_snapshot jsonb := jsonb_build_object(
    'schemaVersion', 3,
    'branding', '{}'::jsonb,
    'blocks', '[]'::jsonb,
    'layout', '{}'::jsonb,
    'sections', '[]'::jsonb,
    'fieldGroups', '[]'::jsonb,
    'blockRules', '[]'::jsonb
  );
  saved public.submissions%rowtype;
  claimed integer;
begin
  insert into auth.users (id, email, created_at, updated_at)
  values (
    owner_id,
    'rpc-' || replace(owner_id::text, '-', '') || '@example.invalid',
    now(),
    now()
  );

  insert into public.profiles (id, email, full_name)
  values (
    owner_id,
    'rpc-' || replace(owner_id::text, '-', '') || '@example.invalid',
    'Public submission RPC verification'
  );

  insert into public.organizations (id, name, slug, created_by)
  values (
    organization_id,
    'Public submission RPC verification',
    'public-rpc-' || replace(organization_id::text, '-', ''),
    owner_id
  );

  insert into public.document_templates (
    id,
    org_id,
    title,
    status,
    revision,
    content,
    created_by,
    updated_by,
    published_by,
    published_at
  )
  values
    (
      template_id,
      organization_id,
      'Public submission RPC verification',
      'published',
      1,
      template_snapshot,
      owner_id,
      owner_id,
      owner_id,
      now()
    ),
    (
      other_template_id,
      organization_id,
      'Public submission RPC verification (another template)',
      'published',
      1,
      template_snapshot,
      owner_id,
      owner_id,
      owner_id,
      now()
    );

  insert into public.public_form_links (
    id,
    org_id,
    template_id,
    token,
    status,
    max_submissions,
    created_by
  )
  values (link_id, organization_id, template_id, link_token, 'active', 2, owner_id);

  insert into public.submissions (
    id,
    org_id,
    title,
    template_id,
    template_revision,
    template_snapshot,
    "values",
    status,
    revision,
    public_form_link_id,
    public_draft_token,
    created_at,
    updated_at
  )
  values (
    draft_id,
    organization_id,
    'Public submission RPC verification draft',
    template_id,
    1,
    template_snapshot,
    '{}'::jsonb,
    'draft',
    1,
    link_id,
    draft_token,
    now(),
    now()
  );

  -- A stale draft revision is refused and uses no capacity.
  begin
    perform public.submit_public_form_entry(
      link_token, draft_token, 7, null, null, null, null, null, '{}'::jsonb, now()
    );
    raise exception 'A stale draft revision was accepted.';
  exception when sqlstate '40001' then
    null;
  end;

  select public_link.submission_count into claimed
  from public.public_form_links public_link
  where public_link.id = link_id;

  if claimed <> 0 then
    raise exception 'A refused draft used capacity (count %).', claimed;
  end if;

  -- The draft is submitted once and counted once.
  select * into saved
  from public.submit_public_form_entry(
    link_token, draft_token, 1, null, null, null, null, null, '{}'::jsonb, now()
  );

  if saved.id <> draft_id
      or saved.status <> 'submitted'
      or saved.public_draft_token is not null
      or saved.revision <> 2
      or saved.submitted_at is null then
    raise exception 'The draft was not submitted as expected.';
  end if;

  -- Submitting the same draft again, as a second tab does once the first
  -- commits, is refused and uses nothing.
  begin
    perform public.submit_public_form_entry(
      link_token, draft_token, 1, null, null, null, null, null, '{}'::jsonb, now()
    );
    raise exception 'A draft was submitted twice.';
  exception when sqlstate '40001' then
    null;
  end;

  select public_link.submission_count into claimed
  from public.public_form_links public_link
  where public_link.id = link_id;

  if claimed <> 1 then
    raise exception 'One submitted draft should use one slot (count %).', claimed;
  end if;

  -- A new submission is saved to the link's organization and counted.
  select * into saved
  from public.submit_public_form_entry(
    link_token, null, null, gen_random_uuid(), '  Walk-in visitor  ',
    template_id, 1, template_snapshot, '{}'::jsonb, now()
  );

  if saved.title <> 'Walk-in visitor'
      or saved.org_id <> organization_id
      or saved.public_form_link_id <> link_id
      or saved.status <> 'submitted'
      or saved.revision <> 1 then
    raise exception 'The new submission was not saved as expected.';
  end if;

  -- The ceiling holds: a third submission is refused and nothing is saved.
  begin
    perform public.submit_public_form_entry(
      link_token, null, null, gen_random_uuid(), 'Over the limit',
      template_id, 1, template_snapshot, '{}'::jsonb, now()
    );
    raise exception 'A full link accepted a submission.';
  exception when sqlstate '55000' then
    null;
  end;

  if (
    select count(*)
    from public.submissions submission
    where submission.public_form_link_id = link_id
  ) <> 2 then
    raise exception 'A refused submission left a row behind.';
  end if;

  -- A save that fails uses no capacity.
  update public.public_form_links public_link
  set max_submissions = null
  where public_link.id = link_id;

  begin
    perform public.submit_public_form_entry(
      link_token, null, null, draft_id, 'Duplicate id',
      template_id, 1, template_snapshot, '{}'::jsonb, now()
    );
    raise exception 'A duplicate submission id was saved.';
  exception when unique_violation then
    null;
  end;

  select public_link.submission_count into claimed
  from public.public_form_links public_link
  where public_link.id = link_id;

  if claimed <> 2 then
    raise exception 'A failed save used capacity (count %).', claimed;
  end if;

  -- A submission must use the link's own template, not another one in the
  -- same organization.
  begin
    perform public.submit_public_form_entry(
      link_token, null, null, gen_random_uuid(), 'Wrong template',
      other_template_id, 1, template_snapshot, '{}'::jsonb, now()
    );
    raise exception 'A submission for another template was accepted.';
  exception when sqlstate '22023' then
    null;
  end;

  -- Missing details are refused before anything is locked.
  begin
    perform public.submit_public_form_entry(
      null, null, null, null, null, null, null, null, null, null
    );
    raise exception 'Missing submission details were accepted.';
  exception when sqlstate '22023' then
    null;
  end;

  -- Disabled and expired links accept nothing.
  update public.public_form_links public_link
  set status = 'disabled'
  where public_link.id = link_id;

  begin
    perform public.submit_public_form_entry(
      link_token, null, null, gen_random_uuid(), 'Disabled link',
      template_id, 1, template_snapshot, '{}'::jsonb, now()
    );
    raise exception 'A disabled link accepted a submission.';
  exception when sqlstate '55000' then
    null;
  end;

  update public.public_form_links public_link
  set status = 'active',
      expires_at = now() - interval '1 minute'
  where public_link.id = link_id;

  begin
    perform public.submit_public_form_entry(
      link_token, null, null, gen_random_uuid(), 'Expired link',
      template_id, 1, template_snapshot, '{}'::jsonb, now()
    );
    raise exception 'An expired link accepted a submission.';
  exception when sqlstate '55000' then
    null;
  end;

  select public_link.submission_count into claimed
  from public.public_form_links public_link
  where public_link.id = link_id;

  if claimed <> 2 then
    raise exception 'Refused submissions used capacity (count %).', claimed;
  end if;

  delete from public.organizations
  where id = organization_id;

  delete from auth.users
  where id = owner_id;
end;
$$;
