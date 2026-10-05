-- Database hygiene, release hardening round three.
--
-- Each block below says what it fixes. Functions redefined here are copied
-- from their current definitions; `create or replace` keeps their grants.

-- A submission's public link is part of its immutable identity (see
-- enforce_submission_update), so the link can no longer be cleared by the
-- foreign key: a link with answers cannot be deleted on its own, and an
-- organization's delete removes both together.
alter table public.submissions
  drop constraint submissions_public_form_link_fkey,
  add constraint submissions_public_form_link_fkey
    foreign key (public_form_link_id, org_id)
    references public.public_form_links (id, org_id);

-- A task's submission must be in the task's own organization. Deleting the
-- submission clears only the task's pointer, never its org_id.
alter table public.tasks
  drop constraint tasks_submission_id_fkey,
  add constraint tasks_submission_id_fkey
    foreign key (submission_id, org_id)
    references public.submissions (id, org_id)
    on delete set null (submission_id);

-- An organization's delete cascades to its purge objects; the upload barrier
-- guards a worker finalizing one early, not the organization going away.
create or replace function private.enforce_resource_purge_object_delete_barrier()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.organizations organization
    where organization.id = old.org_id
  ) then
    return old;
  end if;

  if old.available_at > clock_timestamp() then
    raise exception 'Purge object cannot be finalized before its upload barrier.'
      using errcode = 'P0001';
  end if;

  return old;
end;
$$;

-- Deleting a user no longer fails on the tasks and reminders they touched:
-- who created or last changed a task or reminder is kept while they exist,
-- and a reminder addressed to them goes with them.
alter table public.tasks
  alter column created_by drop not null,
  alter column updated_by drop not null,
  drop constraint tasks_created_by_fkey,
  drop constraint tasks_updated_by_fkey,
  add constraint tasks_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  add constraint tasks_updated_by_fkey
    foreign key (updated_by) references public.profiles (id) on delete set null;

alter table public.task_reminders
  alter column created_by drop not null,
  drop constraint task_reminders_created_by_fkey,
  drop constraint task_reminders_recipient_user_id_fkey,
  add constraint task_reminders_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  add constraint task_reminders_recipient_user_id_fkey
    foreign key (recipient_user_id) references public.profiles (id) on delete cascade;

-- Every foreign key to profiles gets an index, so deleting a user does not
-- scan these tables.
create index invites_accepted_by_idx on public.invites (accepted_by);
create index invites_invited_by_idx on public.invites (invited_by);
create index folders_archived_by_idx on public.folders (archived_by);
create index folders_created_by_idx on public.folders (created_by);
create index folders_trashed_by_idx on public.folders (trashed_by);
create index folders_updated_by_idx on public.folders (updated_by);
create index documents_archived_by_idx on public.documents (archived_by);
create index documents_trashed_by_idx on public.documents (trashed_by);
create index documents_updated_by_idx on public.documents (updated_by);
create index document_versions_uploaded_by_idx on public.document_versions (uploaded_by);
create index resource_purge_jobs_requested_by_idx on public.resource_purge_jobs (requested_by);
create index resource_purge_receipts_requested_by_idx on public.resource_purge_receipts (requested_by);
create index public_form_links_created_by_idx on public.public_form_links (created_by);
create index document_template_versions_published_by_idx on public.document_template_versions (published_by);
create index submission_answer_suggestions_decided_by_idx on public.submission_answer_suggestions (decided_by);
create index submission_answer_suggestions_suggested_by_idx on public.submission_answer_suggestions (suggested_by);

-- Indexes another index already covers.
drop index public.public_form_links_token_idx;
drop index public.task_reminders_task_id_idx;
drop index public.document_guest_grants_org_document_idx;

-- Functions nothing calls: the counter submit_public_form_entry replaced,
-- and a one-off barrier backfill.
drop function public.increment_public_form_link_submission_count(text);
drop function public.reconcile_document_upload_authorization_barriers(timestamptz);

-- Signed-in users hold no table privileges (20260912194858), so these
-- policies and the base-role helpers only they read are dead.
drop policy profiles_select_related on public.profiles;
drop policy organizations_select_member on public.organizations;
drop policy organization_memberships_select_member on public.organization_memberships;
drop policy organization_roles_select_member on public.organization_roles;
drop policy invites_select_manager on public.invites;
drop policy audit_logs_select_manager on public.audit_logs;
drop policy document_templates_select_published_member on public.document_templates;
drop policy submissions_select_internal_member on public.submissions;
drop policy submission_files_select_internal_member on public.submission_files;
drop policy submission_comments_select_visible_submission on public.submission_comments;
drop policy submission_activity_select_visible_submission on public.submission_activity_events;
drop policy resource_purge_jobs_select_owner on public.resource_purge_jobs;
drop policy resource_purge_tombstones_select_owner on public.resource_purge_tombstones;
drop policy resource_purge_receipts_select_owner on public.resource_purge_receipts;
drop policy notification_deliveries_select_manager on public.notification_deliveries;
drop function public.is_organization_member(uuid);
drop function public.organization_role_for(uuid);
drop function public.shares_organization_with_profile(uuid);

-- A template version is written only by publishing: the trigger that
-- records it runs as its owner, and the service role can no longer insert one.

CREATE OR REPLACE FUNCTION public.record_document_template_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.published_revision = new.revision
      and (tg_op = 'INSERT' or old.published_revision is distinct from new.published_revision) then
    insert into public.document_template_versions (
      org_id,
      template_id,
      revision,
      title,
      description,
      content,
      published_by,
      published_at
    )
    values (
      new.org_id,
      new.id,
      new.revision,
      new.title,
      new.description,
      new.content,
      new.published_by,
      new.published_at
    );
  end if;

  return null;
end;
$function$;

revoke execute on function public.record_document_template_version() from public, anon, authenticated;
revoke insert on table public.document_template_versions from service_role;

-- A public submission stores the snapshot its link serves, read here rather
-- than taken from the caller: a sent link's frozen content, or the template's
-- published version. A caller who validated against another revision is told
-- to reload. Each submission writes the same activity event and audit row as
-- a signed-in submit, with no actor. The token_hash lookup is unchanged.
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
  where (
    public_link.token = target_public_form_token
    or public_link.token_hash = encode(sha256(convert_to(target_public_form_token, 'UTF8')), 'hex')
  )
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
    where submission.public_draft_token = target_public_draft_token
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

    if locked_link.content_snapshot is not null then
      served_revision := coalesce(locked_link.template_revision_snapshot, 1);
      served_snapshot := locked_link.content_snapshot;
    else
      select version.revision, version.content
      into served_revision, served_snapshot
      from public.document_templates template_row
      join public.document_template_versions version
        on version.org_id = template_row.org_id
        and version.template_id = template_row.id
        and version.revision = template_row.published_revision
      where template_row.id = locked_link.template_id
        and template_row.org_id = locked_link.org_id
        and template_row.status = 'published';

      if not found then
        raise exception 'Public form link is not accepting submissions.'
          using errcode = '55000';
      end if;
    end if;

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

-- One prefix for this app's session settings: bizflow., as
-- enforce_submission_update and decide_submission_suggestion already use.
CREATE OR REPLACE FUNCTION public.enforce_submission_file_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  uploaded_by_cleanup boolean;
  superseded_by_cleanup boolean;
  actorless_visibility_cleanup boolean := false;
  actorless_public_removal boolean := false;
  actorless_expiry_cleanup boolean := false;
  public_removal_context jsonb;
  public_removal_context_text text;
begin
  uploaded_by_cleanup :=
    new.uploaded_by is not distinct from old.uploaded_by
    or (old.uploaded_by is not null and new.uploaded_by is null);
  superseded_by_cleanup :=
    new.superseded_by is not distinct from old.superseded_by
    or (old.superseded_by is not null and new.superseded_by is null);

  if new.status = 'superseded'
      and old.status in ('upload_pending', 'available')
      and new.superseded_by is null then
    select exists (
      select 1
      from public.submissions submission
      where submission.id = old.submission_id
        and submission.org_id = old.org_id
        -- public_form_link_id is added by the following public-form migration.
        -- Reading the composite as JSON keeps this migration independently
        -- applicable while still narrowing actor-less cleanup to public rows.
        and to_jsonb(submission) ->> 'public_form_link_id' is not null
        and submission.created_by is null
        and submission.updated_by is null
        and submission.submitted_by is null
        and not exists (
          select 1
          from jsonb_array_elements(
            coalesce(submission.template_snapshot -> 'blocks', '[]'::jsonb)
          ) blocks(block)
          where block ->> 'type' = 'file_field'
            and block ->> 'fieldKey' = old.field_key
            and (
              select count(*)
              from jsonb_array_elements(
                coalesce(submission.template_snapshot -> 'blocks', '[]'::jsonb)
              ) matching_blocks(matching_block)
              where matching_block ->> 'fieldKey' = old.field_key
            ) = 1
            and private.template_block_is_visible(
              submission.template_snapshot,
              block ->> 'id',
              submission.values
            )
        )
    ) into actorless_visibility_cleanup;

    -- Manual public removal is authorized by the token-scoped RPC below. Its
    -- transaction-local context contains identifiers only (never either raw
    -- token), and this guard re-checks the active link/draft/file relationship.
    begin
      public_removal_context_text := current_setting(
        'bizflow.public_file_removal_context',
        true
      );

      if public_removal_context_text is not null
          and public_removal_context_text <> '' then
        public_removal_context := public_removal_context_text::jsonb;

        select exists (
          select 1
          from public.submissions submission
          join public.public_form_links public_link
            on public_link.id = (
              public_removal_context ->> 'publicFormLinkId'
            )::uuid
            and public_link.id = (
              to_jsonb(submission) ->> 'public_form_link_id'
            )::uuid
            and public_link.org_id = submission.org_id
          where submission.id = (
              public_removal_context ->> 'submissionId'
            )::uuid
            and submission.id = old.submission_id
            and submission.org_id = old.org_id
            and submission.status = 'draft'
            and to_jsonb(submission) ->> 'public_draft_token' is not null
            and public_link.status = 'active'
            and (
              public_link.expires_at is null
              or public_link.expires_at > now()
            )
            and old.id = (
              public_removal_context ->> 'fileId'
            )::uuid
        ) into actorless_public_removal;
      end if;
    exception
      when others then
        actorless_public_removal := false;
    end;

    -- Expiry needs no caller context: an upload window that has elapsed can
    -- never complete, and a public draft whose handle was cleared can never be
    -- resumed or submitted.
    actorless_expiry_cleanup :=
      (old.status = 'upload_pending' and old.cleanup_after <= now())
      or exists (
        select 1
        from public.submissions submission
        where submission.id = old.submission_id
          and submission.org_id = old.org_id
          and submission.status = 'draft'
          and submission.public_form_link_id is not null
          and submission.created_by is null
          and submission.public_draft_token is null
      );
  end if;

  if new.id is distinct from old.id
      or new.org_id is distinct from old.org_id
      or new.submission_id is distinct from old.submission_id
      or new.field_key is distinct from old.field_key
      or new.storage_key is distinct from old.storage_key
      or new.original_filename is distinct from old.original_filename
      or new.safe_filename is distinct from old.safe_filename
      or new.content_type is distinct from old.content_type
      or new.byte_size is distinct from old.byte_size
      or new.expected_checksum_sha256 is distinct from old.expected_checksum_sha256
      or new.created_at is distinct from old.created_at
      or not uploaded_by_cleanup then
    raise exception 'Submission file identity is immutable.'
      using errcode = '23514';
  end if;

  if old.status = 'superseded' then
    if new.status is distinct from old.status
        or new.checksum_sha256 is distinct from old.checksum_sha256
        or new.available_at is distinct from old.available_at
        or new.superseded_at is distinct from old.superseded_at
        or new.cleanup_after is distinct from old.cleanup_after
        or not superseded_by_cleanup then
      raise exception 'Superseded submission files are immutable.'
        using errcode = '23514';
    end if;

    if old.storage_cleaned_at is null
        and new.storage_cleaned_at is not null then
      if new.updated_at < old.updated_at then
        raise exception 'Submission file cleanup timestamp is invalid.'
          using errcode = '23514';
      end if;

      return new;
    end if;

    if new.storage_cleaned_at is distinct from old.storage_cleaned_at
        or new.updated_at is distinct from old.updated_at then
      raise exception 'Superseded submission files are immutable.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if old.status = 'available' and new.status = 'available' then
    if new.checksum_sha256 is distinct from old.checksum_sha256
        or new.updated_at is distinct from old.updated_at
        or new.available_at is distinct from old.available_at
        or new.superseded_at is distinct from old.superseded_at
        or new.cleanup_after is distinct from old.cleanup_after
        or new.storage_cleaned_at is distinct from old.storage_cleaned_at
        or not superseded_by_cleanup then
      raise exception 'Available submission files are immutable.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if old.status = 'upload_pending' and new.status = 'upload_pending' then
    if new.checksum_sha256 is distinct from old.checksum_sha256
        or new.available_at is distinct from old.available_at
        or new.superseded_at is distinct from old.superseded_at
        or new.storage_cleaned_at is distinct from old.storage_cleaned_at
        or not superseded_by_cleanup
        or new.cleanup_after < old.cleanup_after then
      raise exception 'Pending submission files are immutable.'
        using errcode = '23514';
    end if;

    if new.cleanup_after = old.cleanup_after
        and new.updated_at is distinct from old.updated_at then
      raise exception 'Pending submission files are immutable.'
        using errcode = '23514';
    end if;

    if new.cleanup_after > old.cleanup_after
        and new.updated_at < old.updated_at then
      raise exception 'Submission file upload window is invalid.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if old.status = 'upload_pending' and new.status = 'available' then
    if new.checksum_sha256 is null
        or new.available_at is null
        or new.superseded_by is not null
        or new.superseded_at is not null
        or new.cleanup_after is distinct from old.cleanup_after
        or new.storage_cleaned_at is not null then
      raise exception 'Verified file metadata is required for availability.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.status = 'superseded'
      and old.status in ('upload_pending', 'available') then
    if new.checksum_sha256 is distinct from old.checksum_sha256
        or new.available_at is distinct from old.available_at
        or (
          new.superseded_by is null
          and not actorless_visibility_cleanup
          and not actorless_public_removal
          and not actorless_expiry_cleanup
        )
        or new.superseded_at is null
        or new.cleanup_after is distinct from old.cleanup_after
        or new.storage_cleaned_at is not null then
      raise exception 'Valid superseded file metadata is required.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  raise exception 'Submission file state transition is invalid.'
    using errcode = '23514';
end;
$function$;

CREATE OR REPLACE FUNCTION public.supersede_public_submission_file(target_public_form_token text, target_public_draft_token text, target_file_id uuid)
 RETURNS public.submission_files
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  where (
    public_link.token = target_public_form_token
    or public_link.token_hash = encode(sha256(convert_to(target_public_form_token, 'UTF8')), 'hex')
  )
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
      = target_public_draft_token
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
$function$;

-- A table's row count that is not a whole number, and a date that does not
-- exist, are invalid answers (22023), not a cast error (22P02, 22008).
CREATE OR REPLACE FUNCTION private.template_answer_has_valid_shape(target_block jsonb, target_value jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when target_block ->> 'type' = 'checkbox_field' then
      jsonb_typeof(target_value) = 'boolean'
    when target_block ->> 'type' = 'dropdown_field'
        and target_block -> 'multiple' = 'true'::jsonb then
      case
        when jsonb_typeof(target_value) is distinct from 'array' then false
        else not exists (
            select 1
            from jsonb_array_elements(target_value) choice(value)
            where not coalesce(
              (target_block -> 'options') @> jsonb_build_array(choice.value),
              false
            )
          )
          and jsonb_array_length(target_value) = (
            select count(distinct choice.value)
            from jsonb_array_elements(target_value) choice(value)
          )
      end
    when target_block ->> 'type' = 'choice_grid_field' then
      case
        when jsonb_typeof(target_value) is distinct from 'object' then false
        else not exists (
          select 1
          from jsonb_each(target_value) entry
          where not coalesce((target_block -> 'rows') ? entry.key, false)
            or not coalesce(
              (target_block -> 'options') @> jsonb_build_array(entry.value),
              false
            )
        )
      end
    when target_block ->> 'type' = 'table_field' then
      case
        when jsonb_typeof(target_value) is distinct from 'array' then false
        when jsonb_array_length(target_value) > case
            when target_block -> 'addRows' = 'true'::jsonb then 100
            when (target_block ->> 'rows') ~ '^[0-9]{1,6}$' then (target_block ->> 'rows')::integer
            else 0
          end then false
        else not exists (
          select 1
          from jsonb_array_elements(target_value) table_row(value)
          where case
            when jsonb_typeof(table_row.value) <> 'array' then true
            else jsonb_array_length(table_row.value)
                is distinct from jsonb_array_length(target_block -> 'columns')
              or exists (
                select 1
                from jsonb_array_elements(table_row.value) cell(value)
                where jsonb_typeof(cell.value) <> 'string'
                  or char_length(cell.value #>> '{}') > 500
              )
          end
        )
      end
    else jsonb_typeof(target_value) = 'string'
  end
$function$;

CREATE OR REPLACE FUNCTION public.validate_internal_submission_values(target_template_snapshot jsonb, target_values jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  answer record;
  matching_block jsonb;
  answer_text text;
  visible_scalar_values jsonb;
begin
  if target_values is null or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Submission values must be a JSON object.'
      using errcode = '22023';
  end if;

  visible_scalar_values := private.prune_template_scalar_values(
    target_template_snapshot,
    target_values
  );

  if visible_scalar_values is distinct from target_values then
    raise exception 'Submission values contain a hidden, unknown, duplicated, or file field.'
      using errcode = '22023';
  end if;

  for answer in
    select entry.key, entry.value
    from jsonb_each(target_values) entry
  loop
    select block
    into matching_block
    from jsonb_array_elements(
      coalesce(target_template_snapshot -> 'blocks', '[]'::jsonb)
    ) blocks(block)
    where block ->> 'fieldKey' = answer.key
    limit 1;

    if matching_block is null
        or matching_block ->> 'type' = 'file_field' then
      raise exception 'Submission value % is not a scalar field in this snapshot.', answer.key
        using errcode = '22023';
    end if;

    if matching_block ->> 'type' = 'checkbox_field' then
      if jsonb_typeof(answer.value) <> 'boolean' then
        raise exception 'Submission field % must be a boolean.', answer.key
          using errcode = '22023';
      end if;

      continue;
    end if;

    if not private.template_answer_has_valid_shape(matching_block, answer.value) then
      raise exception 'Submission field % does not fit its field.', answer.key
        using errcode = '22023';
    end if;

    -- Lists and records were checked whole just now; the rules below are for text.
    if jsonb_typeof(answer.value) <> 'string' then
      continue;
    end if;

    answer_text := answer.value #>> '{}';

    if matching_block ->> 'type' in ('signature_field', 'initials_field') then
      if char_length(answer_text) > 2800000
          or (
            answer_text <> ''
            and answer_text !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$'
          ) then
        raise exception 'Submission drawing field % is invalid.', answer.key
          using errcode = '22023';
      end if;

      continue;
    end if;

    if char_length(answer_text) > 20000 then
      raise exception 'Submission field % is too long.', answer.key
        using errcode = '22023';
    end if;

    if matching_block ->> 'type' = 'date_field'
        and answer_text <> ''
        and (
          answer_text !~ '^\d{4}-\d{2}-\d{2}$'
          or not pg_input_is_valid(answer_text, 'date')
        ) then
      raise exception 'Submission field % must be a valid date.', answer.key
        using errcode = '22023';
    end if;

    if matching_block ->> 'type' = 'dropdown_field'
        and answer_text <> ''
        and not coalesce((matching_block -> 'options') ? answer_text, false) then
      raise exception 'Submission field % must use an available option.', answer.key
        using errcode = '22023';
    end if;
  end loop;
end;
$function$;

notify pgrst, 'reload schema';
