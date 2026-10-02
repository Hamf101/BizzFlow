-- Exercises working copy rooms against a real database: who may join a room's
-- channel, updates kept strictly in order with a stale writer refused, the
-- working copy written with its update and never onto an archived template or
-- a document already sent, compaction, and that signed-in users reach none of
-- it directly. Creates isolated synthetic rows inside one statement and
-- removes them before returning; any failed check rolls everything back.
do $$
<<working_copy_rooms_test>>
declare
  owner_id uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  staff_id uuid := gen_random_uuid();
  reviewer_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  other_organization_id uuid := gen_random_uuid();
  template_id uuid := gen_random_uuid();
  archived_template_id uuid := gen_random_uuid();
  document_id uuid := gen_random_uuid();
  sent_document_id uuid := gen_random_uuid();
  template_room_id uuid := gen_random_uuid();
  archived_room_id uuid := gen_random_uuid();
  document_room_id uuid := gen_random_uuid();
  sent_room_id uuid := gen_random_uuid();
  blank constant jsonb := '{"schemaVersion":3,"branding":{},"blocks":[],"layout":{},"sections":[],"fieldGroups":[],"blockRules":[]}';
  written constant jsonb := '{"schemaVersion":3,"branding":{},"blocks":[{"id":"70000000-0000-4000-8000-000000000001","type":"paragraph","text":"Together","alignment":"left"}],"layout":{},"sections":[],"fieldGroups":[],"blockRules":[]}';
  hash_a constant text := repeat('a', 64);
  hash_b constant text := repeat('b', 64);
  kept bigint;
  joined boolean;
  expectation record;
begin
  insert into auth.users (id, email, created_at, updated_at)
  select member.id, 'rpc-' || replace(member.id::text, '-', '') || '@example.invalid', now(), now()
  from unnest(array[owner_id, manager_id, staff_id, reviewer_id, outsider_id]) as member(id);

  insert into public.profiles (id, email, full_name)
  select member.id, 'rpc-' || replace(member.id::text, '-', '') || '@example.invalid', 'Working copy verification'
  from unnest(array[owner_id, manager_id, staff_id, reviewer_id, outsider_id]) as member(id);

  insert into public.organizations (id, name, slug, created_by)
  values
    (organization_id, 'Working copy verification', 'wc-rpc-' || replace(organization_id::text, '-', ''), owner_id),
    (other_organization_id, 'Working copy elsewhere', 'wc-rpc-' || replace(other_organization_id::text, '-', ''), outsider_id);

  insert into public.organization_memberships (org_id, user_id, role, status)
  select organization_id, owner_id, 'owner_admin', 'active'
  where not exists (
    select 1 from public.organization_memberships membership
    where membership.org_id = organization_id and membership.user_id = owner_id
  );

  insert into public.organization_memberships (org_id, user_id, role, status)
  values
    (organization_id, manager_id, 'manager', 'active'),
    (organization_id, staff_id, 'staff', 'active'),
    (organization_id, reviewer_id, 'external_reviewer', 'active');

  insert into public.organization_memberships (org_id, user_id, role, status)
  select other_organization_id, outsider_id, 'owner_admin', 'active'
  where not exists (
    select 1 from public.organization_memberships membership
    where membership.org_id = other_organization_id and membership.user_id = outsider_id
  );

  insert into public.document_templates (id, org_id, title, content, created_by, updated_by)
  values
    (template_id, organization_id, 'Shared template', blank, owner_id, owner_id),
    (archived_template_id, organization_id, 'Archived template', blank, owner_id, owner_id);

  update public.document_templates
  set status = 'archived', archived_at = now(), archived_by = owner_id
  where id = archived_template_id;

  -- Staff start both documents, so they contribute to them; one is sent.
  insert into public.documents (id, org_id, title, source_kind, template_snapshot, created_by, updated_by)
  values
    (document_id, organization_id, 'Draft together', 'generated', blank, staff_id, staff_id),
    (sent_document_id, organization_id, 'Already sent', 'generated', blank, staff_id, staff_id);

  insert into public.document_signing_recipients (org_id, document_id, name, email, token_hash, token_expires_at)
  values (organization_id, sent_document_id, 'Signer', 'signer@example.invalid', repeat('c', 64), now() + interval '1 day');

  insert into public.working_copy_rooms (id, org_id, template_id, document_id, state, saved_hash)
  values
    (template_room_id, organization_id, template_id, null, '\x00'::bytea, hash_a),
    (archived_room_id, organization_id, archived_template_id, null, '\x00'::bytea, hash_a),
    (document_room_id, organization_id, null, document_id, '\x00'::bytea, hash_a),
    (sent_room_id, organization_id, null, sent_document_id, '\x00'::bytea, hash_a);

  -- Who may join which channel.
  for expectation in
    select * from (values
      (owner_id, template_room_id, true),
      (manager_id, template_room_id, true),
      (staff_id, template_room_id, false),
      (reviewer_id, template_room_id, false),
      (outsider_id, template_room_id, false),
      (owner_id, document_room_id, true),
      (staff_id, document_room_id, true),
      (reviewer_id, document_room_id, false),
      (outsider_id, document_room_id, false)
    ) as cases(actor, room, allowed)
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', expectation.actor, 'role', 'authenticated')::text, true);
    joined := private.can_join_working_copy('working-copy:' || expectation.room);

    if joined is distinct from expectation.allowed then
      raise exception 'Joining room % as % should be %, was %.', expectation.room, expectation.actor, expectation.allowed, joined;
    end if;
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);

  if private.can_join_working_copy('working-copy:' || gen_random_uuid())
      or private.can_join_working_copy('working-copy:' || template_room_id || 'x')
      or private.can_join_working_copy('template:' || template_room_id)
      or private.can_join_working_copy(null) then
    raise exception 'A channel that is not a known room was joinable.';
  end if;

  perform set_config('request.jwt.claims', null, true);

  if private.can_join_working_copy('working-copy:' || template_room_id) then
    raise exception 'Someone not signed in joined a room.';
  end if;

  -- Updates are kept one after another; a writer that missed one is refused.
  kept := public.append_working_copy_update(organization_id, template_room_id, 0, '\x01'::bytea, manager_id);

  if kept is distinct from 1::bigint then
    raise exception 'The first update should be revision 1, was %.', kept;
  end if;

  if public.append_working_copy_update(organization_id, template_room_id, 0, '\x02'::bytea, owner_id) is not null then
    raise exception 'An update written from a stale revision was kept.';
  end if;

  if public.append_working_copy_update(other_organization_id, template_room_id, 1, '\x02'::bytea, outsider_id) is not null then
    raise exception 'An update was kept for a room in another organization.';
  end if;

  kept := public.append_working_copy_update(
    organization_id, template_room_id, 1, '\x02'::bytea, owner_id,
    jsonb_build_object('title', 'Written together', 'description', null, 'category', 'Sales', 'content', written),
    hash_b
  );

  if kept is distinct from 2::bigint or not exists (
    select 1
    from public.document_templates template
    join public.working_copy_rooms room on room.template_id = template.id
    where template.id = working_copy_rooms_test.template_id
      and template.title = 'Written together'
      and template.category = 'Sales'
      and template.content = written
      and template.revision = 2
      and template.updated_by = owner_id
      and room.saved_hash = hash_b
      and room.revision = 2
  ) then
    raise exception 'The working copy was not written with its update.';
  end if;

  if (select array_agg(update.revision order by update.revision) from public.working_copy_updates update where update.room_id = template_room_id)
      is distinct from array[1, 2]::bigint[] then
    raise exception 'Updates were not kept in order.';
  end if;

  -- Nothing is kept when the working copy cannot be written.
  begin
    perform public.append_working_copy_update(
      organization_id, archived_room_id, 0, '\x03'::bytea, owner_id,
      jsonb_build_object('title', 'Revived', 'description', null, 'category', null, 'content', written),
      hash_b
    );
    raise exception 'An archived template was written.';
  exception when sqlstate '23514' then
    null;
  end;

  begin
    perform public.append_working_copy_update(
      organization_id, sent_room_id, 0, '\x03'::bytea, staff_id,
      jsonb_build_object('title', 'Changed after sending', 'content', written),
      hash_b
    );
    raise exception 'A document that was sent was written.';
  exception when sqlstate '23514' then
    null;
  end;

  if exists (
    select 1 from public.working_copy_updates update where update.room_id in (archived_room_id, sent_room_id)
  ) or exists (
    select 1 from public.working_copy_rooms room where room.id in (archived_room_id, sent_room_id) and room.revision <> 0
  ) then
    raise exception 'A refused update was kept.';
  end if;

  kept := public.append_working_copy_update(
    organization_id, document_room_id, 0, '\x04'::bytea, staff_id,
    jsonb_build_object('title', 'Drafted together', 'content', written),
    hash_b
  );

  if kept is distinct from 1::bigint or not exists (
    select 1 from public.documents document
    where document.id = document_id and document.title = 'Drafted together' and document.template_snapshot = written
  ) then
    raise exception 'A draft document was not written with its update.';
  end if;

  -- Compaction merges what came before and lets it go, once.
  if not public.compact_working_copy_room(organization_id, template_room_id, '\x0102'::bytea, 1) then
    raise exception 'Compaction was refused.';
  end if;

  if public.compact_working_copy_room(organization_id, template_room_id, '\x01'::bytea, 1)
      or public.compact_working_copy_room(organization_id, template_room_id, '\x010203'::bytea, 3) then
    raise exception 'A stale or future compaction was accepted.';
  end if;

  if (select array_agg(update.revision) from public.working_copy_updates update where update.room_id = template_room_id)
      is distinct from array[2]::bigint[]
      or (select room.state from public.working_copy_rooms room where room.id = template_room_id) <> '\x0102'::bytea then
    raise exception 'Compaction did not keep the state and later updates.';
  end if;

  -- Signed-in users reach rooms only through the app.
  if has_table_privilege('authenticated', 'public.working_copy_rooms', 'select')
      or has_table_privilege('authenticated', 'public.working_copy_updates', 'select')
      or has_function_privilege('authenticated', 'public.append_working_copy_update(uuid, uuid, bigint, bytea, uuid, jsonb, text)', 'execute')
      or has_function_privilege('authenticated', 'public.compact_working_copy_room(uuid, uuid, bytea, bigint)', 'execute')
      or has_function_privilege('authenticated', 'private.member_can(uuid, uuid, text)', 'execute')
      or not has_function_privilege('authenticated', 'private.can_join_working_copy(text)', 'execute') then
    raise exception 'Signed-in users hold the wrong privileges on working copy rooms.';
  end if;

  delete from public.organizations
  where id in (organization_id, other_organization_id);

  delete from auth.users
  where id in (owner_id, manager_id, staff_id, reviewer_id, outsider_id);
end;
$$;
