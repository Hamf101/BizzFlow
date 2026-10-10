-- Exercises start_public_form_draft and submit_public_form_entry against a
-- real database: a link and a draft are found by their tokens' hashes alone,
-- a draft keeps the form its link serves, a link's capacity is used only when
-- a submission is saved, a draft is guarded by its revision, and the ceiling
-- holds. A link sent to one person takes one answer. Creates isolated synthetic rows inside one
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
  sent_link_id uuid := gen_random_uuid();
  sent_token text := replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_');
  sent_hash text;
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
    token_hash,
    status,
    max_submissions,
    created_by
  )
  values (
    link_id, organization_id, template_id,
    encode(sha256(convert_to(link_token, 'UTF8')), 'hex'), 'active', 2, owner_id
  );

  -- A draft for another revision of the form is refused; the stored hash is no token.
  begin
    perform public.start_public_form_draft(
      link_token, draft_token, draft_id, 'Stale', 2, '{}'::jsonb, now()
    );
    raise exception 'A draft for another revision was started.';
  exception when sqlstate '40001' then
    null;
  end;

  begin
    perform public.start_public_form_draft(
      encode(sha256(convert_to(link_token, 'UTF8')), 'hex'), draft_token, draft_id, 'By the hash', 1, '{}'::jsonb, now()
    );
    raise exception 'A stored link hash started a draft.';
  exception when sqlstate '55000' then
    null;
  end;

  -- The draft keeps the published form and only its handle's hash.
  select * into saved
  from public.start_public_form_draft(
    link_token, draft_token, draft_id, '  Public submission RPC verification draft ', 1, '{}'::jsonb, now()
  );

  if saved.id <> draft_id
      or saved.status <> 'draft'
      or saved.title <> 'Public submission RPC verification draft'
      or saved.template_snapshot <> template_snapshot
      or saved.template_revision <> 1
      or saved.public_draft_token <> encode(sha256(convert_to(draft_token, 'UTF8')), 'hex') then
    raise exception 'The draft was not started as expected.';
  end if;

  -- The stored hash does not reach the draft.
  begin
    perform public.submit_public_form_entry(
      link_token, saved.public_draft_token, 1, null, null, null, null, null, '{}'::jsonb, now()
    );
    raise exception 'A stored draft hash was accepted as a handle.';
  exception when sqlstate '40001' then
    null;
  end;

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

  -- A new submission is saved to the link's organization and counted, with
  -- the published snapshot whatever the caller sends, and the same activity
  -- event and audit row a signed-in submit writes.
  select * into saved
  from public.submit_public_form_entry(
    link_token, null, null, gen_random_uuid(), '  Walk-in visitor  ',
    template_id, 1, template_snapshot || '{"branding": {"forged": true}}'::jsonb, '{}'::jsonb, now()
  );

  if saved.title <> 'Walk-in visitor'
      or saved.org_id <> organization_id
      or saved.public_form_link_id <> link_id
      or saved.status <> 'submitted'
      or saved.revision <> 1
      or saved.template_snapshot <> template_snapshot then
    raise exception 'The new submission was not saved as expected.';
  end if;

  if not exists (
      select 1 from public.submission_activity_events activity
      where activity.submission_id = saved.id and activity.event_type = 'submitted' and activity.actor_user_id is null
    )
      or not exists (
        select 1 from public.audit_logs audit
        where audit.target_id = saved.id and audit.action = 'submission.submitted' and audit.org_id = organization_id
      ) then
    raise exception 'A public submission left no activity event or audit row.';
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

  -- A link sent to one person keeps only its token's hash. The token finds
  -- it, once; the hash, were it ever read, is not a token.
  sent_token := rtrim(sent_token, '=');
  sent_hash := encode(sha256(convert_to(sent_token, 'UTF8')), 'hex');

  insert into public.public_form_links (
    id, org_id, template_id, token_hash, recipient_email, content_snapshot, title_snapshot, template_revision_snapshot,
    status, max_submissions, created_by
  )
  values (
    sent_link_id, organization_id, template_id, sent_hash, 'ana@example.invalid', template_snapshot, 'Sent', 1,
    'active', 1, owner_id
  );

  begin
    perform public.submit_public_form_entry(
      sent_hash, null, null, gen_random_uuid(), 'By the stored hash',
      template_id, 1, template_snapshot, '{}'::jsonb, now()
    );
    raise exception 'A stored hash was accepted as a token.';
  exception when sqlstate '55000' then
    null;
  end;

  select * into saved
  from public.submit_public_form_entry(
    sent_token, null, null, gen_random_uuid(), 'Sent to Ana',
    template_id, 1, template_snapshot, '{}'::jsonb, now()
  );

  if saved.public_form_link_id <> sent_link_id or saved.org_id <> organization_id then
    raise exception 'A sent link''s answer was not saved to it.';
  end if;

  begin
    perform public.submit_public_form_entry(
      sent_token, null, null, gen_random_uuid(), 'Sent to Ana, again',
      template_id, 1, template_snapshot, '{}'::jsonb, now()
    );
    raise exception 'A sent link took a second answer.';
  exception when sqlstate '55000' then
    null;
  end;

  -- A link sent to one person takes one answer, and every link has a token hash.
  begin
    insert into public.public_form_links (id, org_id, template_id, token_hash, recipient_email, content_snapshot, title_snapshot, template_revision_snapshot, status, max_submissions)
    values (gen_random_uuid(), organization_id, template_id, md5('a') || md5('b'), 'b@example.invalid', template_snapshot, 'Sent', 1, 'active', 5);
    raise exception 'A sent link taking five answers was stored.';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.public_form_links (id, org_id, template_id, status)
    values (gen_random_uuid(), organization_id, template_id, 'active');
    raise exception 'A link without a token hash was stored.';
  exception when not_null_violation then
    null;
  end;

  delete from public.organizations
  where id = organization_id;

  delete from auth.users
  where id = owner_id;
end;
$$;
