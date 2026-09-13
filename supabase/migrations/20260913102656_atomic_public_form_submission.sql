-- Public form submissions claim their link's capacity in the same transaction
-- that saves them.
--
-- The service used to increment public_form_links.submission_count through
-- increment_public_form_link_submission_count and then save the submission in
-- a second request. A draft revision conflict or a failed insert after the
-- increment kept the slot, and two concurrent submits of one draft used two
-- slots for one saved submission, closing a limited link early.
--
-- submit_public_form_entry locks the link, re-checks that it accepts
-- submissions, saves the submission (a revision-guarded draft transition or a
-- new row), and only then counts it. Any refusal or failure rolls the whole
-- call back, so capacity is used exactly when a submission is saved.
--
-- increment_public_form_link_submission_count stays for builds deployed
-- before this change; drop it once none remain.

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
security invoker
set search_path = ''
as $$
declare
  locked_link public.public_form_links%rowtype;
  saved_submission public.submissions%rowtype;
  submits_draft boolean := target_public_draft_token is not null;
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
          or target_template_snapshot is null
          or jsonb_typeof(target_template_snapshot) <> 'object'
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
  where public_link.token = target_public_form_token
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
      target_template_id,
      target_template_revision,
      target_template_snapshot,
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

  return saved_submission;
end;
$$;

revoke all on function public.submit_public_form_entry(
  text, text, integer, uuid, text, uuid, integer, jsonb, jsonb, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.submit_public_form_entry(
  text, text, integer, uuid, text, uuid, integer, jsonb, jsonb, timestamptz
) to service_role;

notify pgrst, 'reload schema';
