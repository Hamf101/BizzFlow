-- Tokens at rest, the folder-tree lock, and the audit log without its hash chain.

-- 1. Public form tokens are kept only as their SHA-256, as a link sent to one
-- person already is. A link for anyone now has the token
-- HMAC-SHA256(server secret, link id), which the app derives again whenever an
-- editor copies the link; an existing link keeps its old token, which the
-- hash below still finds, though the app can no longer show it. A visitor's
-- draft handle is kept as its hash too; the browser holds the handle itself.
-- What tells a link for anyone from a link sent to one person is now the
-- recipient, not which kind of token it has.
alter table public.public_form_links
  drop constraint public_form_links_one_token,
  drop constraint public_form_links_sent_to_one;

update public.public_form_links
set token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
where token is not null;

-- Its unique key, length check and partial index go with it.
alter table public.public_form_links
  drop column token,
  alter column token_hash set not null,
  add constraint public_form_links_sent_to_one check (
    recipient_email is null
    or (max_submissions = 1 and content_snapshot is not null)
  );

-- enforce_submission_update refuses any new draft handle; this rewrites each
-- one as its own hash, which no visitor could have chosen.
alter table public.submissions disable trigger submissions_enforce_update;

update public.submissions
set public_draft_token = encode(sha256(convert_to(public_draft_token, 'UTF8')), 'hex')
where public_draft_token is not null;

alter table public.submissions enable trigger submissions_enforce_update;

-- The form a link serves: a sent link's frozen content, or the template's
-- published version. Refuses a link whose template is no longer published.
create function private.served_public_form(
  link public.public_form_links,
  out revision integer,
  out content jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if link.content_snapshot is not null then
    revision := coalesce(link.template_revision_snapshot, 1);
    content := link.content_snapshot;
    return;
  end if;

  select version.revision, version.content
  into revision, content
  from public.document_templates template_row
  join public.document_template_versions version
    on version.org_id = template_row.org_id
    and version.template_id = template_row.id
    and version.revision = template_row.published_revision
  where template_row.id = link.template_id
    and template_row.org_id = link.org_id
    and template_row.status = 'published';

  if not found then
    raise exception 'Public form link is not accepting submissions.'
      using errcode = '55000';
  end if;
end;
$$;

revoke all on function private.served_public_form(public.public_form_links)
  from public, anon, authenticated;
grant execute on function private.served_public_form(public.public_form_links)
  to service_role;

-- A public draft stores the form its link serves, read here as a submission
-- does, never taken from the caller. A caller who validated its answers
-- against another revision is told the form changed.
create function public.start_public_form_draft(
  target_public_form_token text,
  target_public_draft_token text,
  target_submission_id uuid,
  target_title text,
  target_template_revision integer,
  target_values jsonb,
  target_created_at timestamptz
)
returns public.submissions
language plpgsql
set search_path = ''
as $$
declare
  link public.public_form_links%rowtype;
  served_revision integer;
  served_snapshot jsonb;
  saved_submission public.submissions%rowtype;
begin
  if target_public_form_token is null
      or target_public_draft_token is null
      or target_public_draft_token !~ '^[0-9a-f]{64}$'
      or target_submission_id is null
      or target_title is null
      or btrim(target_title) = ''
      or target_template_revision is null
      or target_values is null
      or jsonb_typeof(target_values) <> 'object'
      or target_created_at is null then
    raise exception 'Valid public draft details are required.'
      using errcode = '22023';
  end if;

  select public_link.*
  into link
  from public.public_form_links public_link
  where public_link.token_hash = encode(sha256(convert_to(target_public_form_token, 'UTF8')), 'hex');

  if not found
      or link.status <> 'active'
      or (link.expires_at is not null and link.expires_at <= now())
      or (
        link.max_submissions is not null
        and link.submission_count >= link.max_submissions
      ) then
    raise exception 'Public form link is not accepting submissions.'
      using errcode = '55000';
  end if;

  select served.revision, served.content
  into served_revision, served_snapshot
  from private.served_public_form(link) served;

  if target_template_revision <> served_revision then
    raise exception 'The form changed. Reload and try again.'
      using errcode = '40001';
  end if;

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
    target_submission_id,
    link.org_id,
    btrim(target_title),
    link.template_id,
    served_revision,
    served_snapshot,
    target_values,
    'draft',
    1,
    link.id,
    encode(sha256(convert_to(target_public_draft_token, 'UTF8')), 'hex'),
    target_created_at,
    target_created_at
  )
  returning * into saved_submission;

  return saved_submission;
end;
$$;

revoke all on function public.start_public_form_draft(text, text, uuid, text, integer, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.start_public_form_draft(text, text, uuid, text, integer, jsonb, timestamptz)
  to service_role;

-- From 20261005110000_db_hygiene: finds the link and the draft by their
-- hashes alone, and reads the served form through served_public_form.
create or replace function public.submit_public_form_entry(
  target_public_form_token text,
  target_public_draft_token text,
  target_expected_revision integer,
  target_submission_id uuid,
  target_title text,
  target_template_id uuid,
  target_template_revision integer,
  target_template_snapshot jsonb,
  target_values jsonb,
  target_submitted_at timestamptz
)
returns public.submissions
language plpgsql
set search_path = ''
as $$
declare
  locked_link public.public_form_links%rowtype;
  saved_submission public.submissions%rowtype;
  submits_draft boolean := target_public_draft_token is not null;
  served_revision integer;
  served_snapshot jsonb;
begin
  if target_public_form_token is null
      or target_public_form_token <> btrim(target_public_form_token)
      or char_length(target_public_form_token) not between 10 and 100
      or target_values is null
      or jsonb_typeof(target_values) <> 'object'
      or target_submitted_at is null
      or (
        submits_draft
        and (
          target_public_draft_token !~ '^[0-9a-f]{64}$'
          or target_expected_revision is null
          or target_expected_revision < 1
        )
      )
      or (
        not submits_draft
        and (
          target_submission_id is null
          or target_title is null
          or btrim(target_title) = ''
          or target_template_id is null
          or target_template_revision is null
        )
      ) then
    raise exception 'Valid public submission details are required.'
      using errcode = '22023';
  end if;

  -- Lock the link first. Concurrent submissions queue here, so each one sees
  -- the capacity every earlier one used.
  select public_link.*
  into locked_link
  from public.public_form_links public_link
  where public_link.token_hash = encode(sha256(convert_to(target_public_form_token, 'UTF8')), 'hex')
  for update;

  if not found
      or locked_link.status <> 'active'
      or (
        locked_link.expires_at is not null
        and locked_link.expires_at <= now()
      )
      or (
        locked_link.max_submissions is not null
        and locked_link.submission_count >= locked_link.max_submissions
      ) then
    raise exception 'Public form link is not accepting submissions.'
      using errcode = '55000';
  end if;

  if submits_draft then
    update public.submissions submission
    set values = target_values,
        status = 'submitted',
        revision = submission.revision + 1,
        public_draft_token = null,
        updated_at = target_submitted_at,
        submitted_at = target_submitted_at
    where submission.public_draft_token = encode(sha256(convert_to(target_public_draft_token, 'UTF8')), 'hex')
      and submission.public_form_link_id = locked_link.id
      and submission.org_id = locked_link.org_id
      and submission.status = 'draft'
      and submission.revision = target_expected_revision
    returning submission.* into saved_submission;

    if not found then
      raise exception 'Public submission draft has changed. Reload and try again.'
        using errcode = '40001';
    end if;
  else
    if target_template_id <> locked_link.template_id then
      raise exception 'Valid public submission details are required.'
        using errcode = '22023';
    end if;

    select served.revision, served.content
    into served_revision, served_snapshot
    from private.served_public_form(locked_link) served;

    if target_template_revision <> served_revision then
      raise exception 'The form changed. Reload and try again.'
        using errcode = '40001';
    end if;

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
      created_at,
      updated_at,
      submitted_at
    )
    values (
      target_submission_id,
      locked_link.org_id,
      btrim(target_title),
      locked_link.template_id,
      served_revision,
      served_snapshot,
      target_values,
      'submitted',
      1,
      locked_link.id,
      target_submitted_at,
      target_submitted_at,
      target_submitted_at
    )
    returning * into saved_submission;
  end if;

  update public.public_form_links public_link
  set submission_count = public_link.submission_count + 1,
      updated_at = now()
  where public_link.id = locked_link.id;

  insert into public.submission_activity_events (
    id,
    org_id,
    submission_id,
    actor_user_id,
    event_type,
    from_status,
    to_status,
    assignee_user_id,
    submission_revision
  )
  values (
    gen_random_uuid(),
    saved_submission.org_id,
    saved_submission.id,
    null,
    'submitted',
    'draft',
    'submitted',
    saved_submission.assigned_to,
    saved_submission.revision
  );

  insert into public.audit_logs (
    id,
    org_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    gen_random_uuid(),
    saved_submission.org_id,
    null,
    'submission.submitted',
    'submission',
    saved_submission.id,
    jsonb_build_object(
      'templateId', saved_submission.template_id,
      'templateRevision', saved_submission.template_revision,
      'submissionRevision', saved_submission.revision,
      'publicFormLinkId', locked_link.id
    )
  );

  return saved_submission;
end;
$$;

-- From its current definition: finds the link and the draft by their hashes.
create or replace function public.supersede_public_submission_file(
  target_public_form_token text,
  target_public_draft_token text,
  target_file_id uuid
)
returns public.submission_files
language plpgsql
set search_path = ''
as $$
declare
  locked_link_id uuid;
  locked_org_id uuid;
  locked_submission_id uuid;
  locked_file public.submission_files%rowtype;
begin
  if target_public_form_token is null
      or target_public_form_token <> btrim(target_public_form_token)
      or char_length(target_public_form_token) not between 10 and 100
      or target_public_draft_token is null
      or target_public_draft_token !~ '^[0-9a-f]{64}$'
      or target_file_id is null then
    raise exception 'Valid public submission file identifiers are required.'
      using errcode = '22023';
  end if;

  -- Lock the public link first so it cannot be disabled or expire through a
  -- concurrent update between authorization and the file transition.
  select public_link.id, public_link.org_id
  into locked_link_id, locked_org_id
  from public.public_form_links public_link
  where public_link.token_hash = encode(sha256(convert_to(target_public_form_token, 'UTF8')), 'hex')
    and public_link.status = 'active'
    and (
      public_link.expires_at is null
      or public_link.expires_at > now()
    )
  for update;

  if not found then
    raise exception 'Public form link is not active.'
      using errcode = 'P0002';
  end if;

  select submission.id
  into locked_submission_id
  from public.submissions submission
  where to_jsonb(submission) ->> 'public_draft_token'
      = encode(sha256(convert_to(target_public_draft_token, 'UTF8')), 'hex')
    and (
      to_jsonb(submission) ->> 'public_form_link_id'
    )::uuid = locked_link_id
    and submission.org_id = locked_org_id
    and submission.status = 'draft'
  for update;

  if not found then
    raise exception 'Public submission draft was not found.'
      using errcode = 'P0002';
  end if;

  select submission_file.*
  into locked_file
  from public.submission_files submission_file
  where submission_file.id = target_file_id
    and submission_file.submission_id = locked_submission_id
    and submission_file.org_id = locked_org_id
    and submission_file.status in ('upload_pending', 'available')
  for update;

  if not found then
    raise exception 'Active public submission file was not found.'
      using errcode = 'P0002';
  end if;

  perform set_config(
    'bizflow.public_file_removal_context',
    jsonb_build_object(
      'publicFormLinkId', locked_link_id,
      'submissionId', locked_submission_id,
      'fileId', target_file_id
    )::text,
    true
  );

  update public.submission_files submission_file
  set status = 'superseded',
      superseded_by = null,
      superseded_at = now(),
      updated_at = now()
  where submission_file.id = target_file_id
    and submission_file.submission_id = locked_submission_id
    and submission_file.org_id = locked_org_id
    and submission_file.status in ('upload_pending', 'available')
  returning submission_file.* into locked_file;

  if not found then
    raise exception 'Active public submission file changed before removal.'
      using errcode = '40001';
  end if;

  perform set_config(
    'bizflow.public_file_removal_context',
    '',
    true
  );

  return locked_file;
end;
$$;

-- 2. A new document needs only its own folder to stay active until it is
-- saved. Trashing, archiving and purging lock each folder they change before
-- they look for its documents, so a share lock on the folder orders the two:
-- whichever comes second sees the other. It is taken without waiting, as the
-- organization's folder-tree lock was, and a busy folder is retried (40001).
-- Two documents saved into one folder no longer turn each other away. Moving
-- a document, and every change to a folder, keep the organization's lock:
-- trash_folder finds a folder's subfolders before it locks them, so a new
-- subfolder could slip past a row lock.
create or replace function private.serialize_document_folder_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_lifecycle_state public.resource_lifecycle_state;
begin
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then
    raise exception 'Documents cannot move between organizations.'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.folder_id is null then
      return new;
    end if;

    begin
      select folder.lifecycle_state
      into parent_lifecycle_state
      from public.folders folder
      where folder.id = new.folder_id
        and folder.org_id = new.org_id
      for share nowait;
    exception
      when lock_not_available then
        raise exception 'Document folder assignment changed concurrently; retry the operation.'
          using errcode = '40001';
    end;
  else
    -- Folder lifecycle RPCs acquire this lock before discovering descendants.
    -- A row trigger cannot safely wait after its document tuple is locked, so a
    -- concurrent assignment is retried instead.
    if not pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended('folder-tree:' || new.org_id::text, 0)
    ) then
      raise exception 'Document folder assignment changed concurrently; retry the operation.'
        using errcode = '40001';
    end if;

    if new.folder_id is null then
      return new;
    end if;

    select folder.lifecycle_state
    into parent_lifecycle_state
    from public.folders folder
    where folder.id = new.folder_id
      and folder.org_id = new.org_id;
  end if;

  if not found then
    raise exception 'Folder not found.'
      using errcode = 'P0002';
  end if;

  if parent_lifecycle_state <> 'active' then
    raise exception 'Documents may only be assigned to active folders.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- 3. The audit log keeps no hash chain (owner decision): its trigger, the
-- per-organization lock it took on every insert, the verifier, its
-- checkpoints and the hash columns go. Entries stay append-only: the service
-- role still cannot update, delete or truncate them (20261003100000), and
-- the row and truncate triggers still refuse every role. seq stays, now from
-- a sequence, as the order the log is read in.
drop trigger audit_logs_chain_link on public.audit_logs;
drop function public.audit_logs_chain_link();
drop function public.verify_audit_log_chain(uuid);
drop table public.audit_log_checkpoints;

-- From 20260725200000_audit_log_hash_chain, without the hash columns.
create or replace function public.enforce_audit_log_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- An organization's delete removes its whole log; the rollback path in
    -- deleteOrganizationRecord depends on this.
    if not exists (
      select 1
      from public.organizations organization
      where organization.id = old.org_id
    ) then
      return old;
    end if;

    raise exception 'Audit log entries cannot be deleted.'
      using errcode = '23514';
  end if;

  -- Deleting a profile may clear the actor and change nothing else.
  if old.actor_user_id is not null
    and new.actor_user_id is null
    and row(
      new.id, new.org_id, new.action, new.target_type, new.target_id,
      new.metadata, new.created_at, new.seq
    ) is not distinct from row(
      old.id, old.org_id, old.action, old.target_type, old.target_id,
      old.metadata, old.created_at, old.seq
    )
  then
    return new;
  end if;

  raise exception 'Audit log entries are immutable.'
    using errcode = '23514';
end;
$$;

alter table public.audit_logs
  drop constraint audit_logs_genesis_prev_hash,
  drop column prev_hash,
  drop column entry_hash;

drop function public.audit_log_entry_digest(text, bigint, uuid, uuid, text, text, uuid, jsonb, timestamptz);

-- Every organization's next entry sorts after its last one.
create sequence public.audit_logs_seq_seq owned by public.audit_logs.seq;
select pg_catalog.setval(
  'public.audit_logs_seq_seq',
  coalesce((select max(seq) from public.audit_logs), 0) + 1,
  false
);
alter table public.audit_logs
  alter column seq set default nextval('public.audit_logs_seq_seq');
grant usage on sequence public.audit_logs_seq_seq to service_role;

-- 4. Three access changes already made in one database call now write their
-- audit row in it too, so the change and its record commit together: a
-- member's role, a role archived, an invite accepted. Each is copied from its
-- current definition (20260903115718, 20260912202419 and 20261003110000)
-- with the insert the service used to make afterwards.
create or replace function public.update_organization_member_access(
  target_org_id uuid,
  target_membership_id uuid,
  target_actor_user_id uuid,
  target_role_definition_id uuid,
  target_workspace_display_name text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  actor_role public.organization_role;
  current_role public.organization_role;
  selected_system_key public.organization_role;
  normalized_display_name text;
  updated_membership_id uuid;
begin
  normalized_display_name := nullif(regexp_replace(
    btrim(target_workspace_display_name),
    '\s+',
    ' ',
    'g'
  ), '');

  if normalized_display_name is not null
      and char_length(normalized_display_name) > 120 then
    raise exception 'Workspace display name is too long.'
      using errcode = '22023';
  end if;

  perform 1
  from public.organizations organization
  where organization.id = target_org_id
  for update;

  if not found then
    raise exception 'Organization was not found.'
      using errcode = 'P0002';
  end if;

  select membership.role
  into actor_role
  from public.organization_memberships membership
  where membership.org_id = target_org_id
    and membership.user_id = target_actor_user_id
    and membership.status = 'active';

  if not found or actor_role <> 'owner_admin' then
    raise exception 'Actor cannot update member access.'
      using errcode = '42501';
  end if;

  select membership.role
  into current_role
  from public.organization_memberships membership
  where membership.id = target_membership_id
    and membership.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Member was not found.'
      using errcode = 'P0002';
  end if;

  select role_definition.system_key
  into selected_system_key
  from public.organization_roles role_definition
  where role_definition.id = target_role_definition_id
    and role_definition.org_id = target_org_id
    and role_definition.archived_at is null;

  if not found then
    raise exception 'That role cannot be assigned.'
      using errcode = '22023';
  end if;

  if current_role = 'owner_admin'
      and selected_system_key is distinct from 'owner_admin' then
    raise exception 'Owner access is permanent.'
      using errcode = '23514';
  end if;

  if current_role <> 'owner_admin' and selected_system_key = 'owner_admin' then
    raise exception 'Owner cannot be assigned from member access.'
      using errcode = '22023';
  end if;

  update public.organization_memberships membership
  set role_definition_id = target_role_definition_id,
      workspace_display_name = normalized_display_name
  where membership.id = target_membership_id
    and membership.org_id = target_org_id
  returning membership.id into updated_membership_id;

  insert into public.audit_logs (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    target_org_id,
    target_actor_user_id,
    'membership.access_updated',
    'membership',
    updated_membership_id,
    jsonb_build_object(
      'roleDefinitionId', target_role_definition_id,
      'workspaceDisplayName', normalized_display_name
    )
  );

  return updated_membership_id;
end;
$$;

create or replace function public.archive_organization_role(
  target_org_id uuid,
  target_actor_user_id uuid,
  target_role_definition_id uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  actor_role public.organization_role;
  selected_system_key public.organization_role;
  archived_role_id uuid;
begin
  perform 1
  from public.organizations organization
  where organization.id = target_org_id
  for update;

  if not found then
    raise exception 'Organization was not found.'
      using errcode = 'P0002';
  end if;

  select membership.role
  into actor_role
  from public.organization_memberships membership
  where membership.org_id = target_org_id
    and membership.user_id = target_actor_user_id
    and membership.status = 'active';

  if not found or actor_role <> 'owner_admin' then
    raise exception 'Actor cannot remove access roles.'
      using errcode = '42501';
  end if;

  select role_definition.system_key
  into selected_system_key
  from public.organization_roles role_definition
  where role_definition.id = target_role_definition_id
    and role_definition.org_id = target_org_id
    and role_definition.archived_at is null
  for update;

  if not found then
    raise exception 'Access role was not found.'
      using errcode = 'P0002';
  end if;

  if selected_system_key = 'owner_admin' then
    raise exception 'Owner access is permanent.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.organization_memberships membership
    where membership.org_id = target_org_id
      and membership.role_definition_id = target_role_definition_id
  ) then
    raise exception 'Role is still assigned to a member.'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from public.invites invite
    where invite.org_id = target_org_id
      and invite.role_definition_id = target_role_definition_id
      and invite.status = 'pending'
      and invite.expires_at > now()
  ) then
    raise exception 'Role is still assigned to an active invite.'
      using errcode = '23503';
  end if;

  update public.organization_roles role_definition
  set archived_at = now()
  where role_definition.id = target_role_definition_id
    and role_definition.org_id = target_org_id
  returning role_definition.id into archived_role_id;

  insert into public.audit_logs (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    target_org_id,
    target_actor_user_id,
    'organization_role.archived',
    'organization_role',
    archived_role_id,
    '{}'::jsonb
  );

  return archived_role_id;
end;
$$;

create or replace function public.accept_organization_invite(
  target_invite_id uuid,
  target_token text,
  target_user_id uuid,
  target_user_email text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  locked_invite_org_id uuid;
  locked_invite_email text;
  locked_invite_role public.organization_role;
  locked_invite_role_definition_id uuid;
  locked_invite_status public.invite_status;
  locked_invite_expires_at timestamptz;
  normalized_user_email text;
  accepted_membership_id uuid;
begin
  normalized_user_email := lower(btrim(target_user_email));

  if normalized_user_email is null
      or char_length(normalized_user_email) < 3
      or char_length(normalized_user_email) > 320
      or position('@' in normalized_user_email) <= 1 then
    raise exception 'Invite email is invalid.'
      using errcode = '22023';
  end if;

  select
    invite.org_id,
    invite.email,
    invite.role,
    invite.role_definition_id,
    invite.status,
    invite.expires_at
  into
    locked_invite_org_id,
    locked_invite_email,
    locked_invite_role,
    locked_invite_role_definition_id,
    locked_invite_status,
    locked_invite_expires_at
  from public.invites invite
  where invite.id = target_invite_id
    and invite.token_hash = encode(sha256(convert_to(coalesce(target_token, ''), 'UTF8')), 'hex')
  for update;

  if not found
      or locked_invite_status <> 'pending'
      or locked_invite_expires_at <= now()
      or locked_invite_email <> normalized_user_email then
    raise exception 'Invite is invalid or expired.'
      using errcode = 'P0002';
  end if;

  insert into public.profiles (id, email)
  values (target_user_id, normalized_user_email)
  on conflict (id)
  do update set email = excluded.email;

  insert into public.organization_memberships (
    org_id,
    user_id,
    role,
    role_definition_id,
    status
  )
  values (
    locked_invite_org_id,
    target_user_id,
    locked_invite_role,
    locked_invite_role_definition_id,
    'active'
  )
  on conflict (org_id, user_id)
  do update
  set role = excluded.role,
      role_definition_id = excluded.role_definition_id,
      status = 'active'
  where organization_memberships.role <> 'owner_admin'
  returning id into accepted_membership_id;

  if accepted_membership_id is null then
    raise exception 'Owner access is permanent.'
      using errcode = '23514';
  end if;

  update public.invites invite
  set status = 'accepted',
      accepted_by = target_user_id,
      accepted_at = now()
  where invite.id = target_invite_id;

  insert into public.audit_logs (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    locked_invite_org_id,
    target_user_id,
    'invite.accepted',
    'invite',
    target_invite_id,
    jsonb_build_object('email', locked_invite_email, 'role', locked_invite_role)
  );

  return accepted_membership_id;
end;
$$;

notify pgrst, 'reload schema';
