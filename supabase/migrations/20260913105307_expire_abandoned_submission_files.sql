-- Abandoned public uploads and dead upload allocations join the existing
-- superseded-object cleanup.
--
-- The nightly cleanup reclaims only superseded files, and nothing moved the
-- rest there: an upload whose window elapsed stayed upload_pending, and an
-- abandoned public draft kept its files. Anyone holding a public link with a
-- file field could keep adding storage by starting drafts and walking away.
--
-- expire_abandoned_submission_files runs before each cleanup pass. It clears
-- the handle of every public draft nobody has saved or uploaded to for a day
-- (the handle's own lifetime), supersedes that draft's files, and supersedes
-- any upload whose window has elapsed. The file guard gains one actor-less
-- path for exactly those two cases; the rest of its body is re-created
-- verbatim from 20260912202419. Drafts locked by a submission in progress are
-- skipped, so a submission that is already underway always wins.

create or replace function public.enforce_submission_file_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
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
        'bizzflow.public_file_removal_context',
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
$$;

revoke all on function public.enforce_submission_file_update()
  from public, anon, authenticated, service_role;

create index if not exists submission_files_pending_expiry_idx
  on public.submission_files (cleanup_after, id)
  where status = 'upload_pending';

create index if not exists submissions_public_draft_expiry_idx
  on public.submissions (updated_at, id)
  where status = 'draft'
    and public_draft_token is not null;

create or replace function public.expire_abandoned_submission_files(
  target_batch_size integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expired_draft_ids uuid[];
  expired_draft_file_count integer := 0;
  dead_upload_count integer := 0;
begin
  if target_batch_size is null or target_batch_size not between 1 and 1000 then
    raise exception 'A cleanup batch size between 1 and 1000 is required.'
      using errcode = '22023';
  end if;

  -- A public draft is abandoned once nobody has saved it or started an upload
  -- for a day: its browser handle lasts 24 hours from the last save, and each
  -- upload's cleanup_after falls 24 hours after it began. Locked drafts are
  -- skipped, so a submission already in progress always wins.
  with abandoned as (
    select submission.id
    from public.submissions submission
    where submission.status = 'draft'
      and submission.public_form_link_id is not null
      and submission.created_by is null
      and submission.public_draft_token is not null
      and submission.updated_at <= now() - interval '24 hours'
      and not exists (
        select 1
        from public.submission_files submission_file
        where submission_file.submission_id = submission.id
          and submission_file.org_id = submission.org_id
          and submission_file.cleanup_after > now()
      )
    order by submission.updated_at, submission.id
    limit target_batch_size
    for update of submission skip locked
  ),
  expired as (
    update public.submissions submission
    set public_draft_token = null
    from abandoned
    where submission.id = abandoned.id
    returning submission.id
  )
  select coalesce(array_agg(expired.id), '{}'::uuid[])
  into expired_draft_ids
  from expired;

  -- With its handle cleared the draft can never be resumed or submitted, so
  -- its files join the cleanup.
  update public.submission_files submission_file
  set status = 'superseded',
      superseded_by = null,
      superseded_at = now(),
      updated_at = now()
  where submission_file.submission_id = any(expired_draft_ids)
    and submission_file.status in ('upload_pending', 'available');

  get diagnostics expired_draft_file_count = row_count;

  -- An upload whose window has elapsed can never complete.
  with dead as (
    select submission_file.id
    from public.submission_files submission_file
    where submission_file.status = 'upload_pending'
      and submission_file.cleanup_after <= now()
    order by submission_file.cleanup_after, submission_file.id
    limit target_batch_size
    for update skip locked
  )
  update public.submission_files submission_file
  set status = 'superseded',
      superseded_by = null,
      superseded_at = now(),
      updated_at = now()
  from dead
  where submission_file.id = dead.id;

  get diagnostics dead_upload_count = row_count;

  return jsonb_build_object(
    'expired_drafts', cardinality(expired_draft_ids),
    'expired_files', expired_draft_file_count + dead_upload_count
  );
end;
$$;

revoke all on function public.expire_abandoned_submission_files(
  integer
) from public, anon, authenticated, service_role;

grant execute on function public.expire_abandoned_submission_files(
  integer
) to service_role;

notify pgrst, 'reload schema';
