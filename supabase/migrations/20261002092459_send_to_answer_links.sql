-- Send to answer: a document or template sent to named people, each with a
-- link of their own that takes one set of answers.
--
-- A sent link is a public_form_links row whose token is stored only as its
-- SHA-256 (token_hash): the plaintext exists in the email and, once, in the
-- sender's response when the email could not go. Its recipient and a cap of
-- one submission are required, so a forwarded link answers once, and the
-- content it was sent with is frozen in content_snapshot, with its title and
-- template revision (and the answers already in a document in
-- answers_snapshot), so later edits never change what the recipient sees. An anyone-link keeps its plaintext token, as before.
--
-- Rows are never deleted: submissions point at them with
-- (public_form_link_id, org_id) on delete set null, which would null org_id.

alter table public.public_form_links
  alter column token drop not null,
  add column token_hash text,
  add column recipient_email text,
  add column document_id uuid,
  add column content_snapshot jsonb,
  add column answers_snapshot jsonb,
  add column title_snapshot text,
  add column template_revision_snapshot integer,
  add column sent_by uuid references public.profiles (id) on delete set null;

alter table public.public_form_links
  add constraint public_form_links_token_hash_key unique (token_hash),
  add constraint public_form_links_one_token check ((token is null) <> (token_hash is null)),
  add constraint public_form_links_token_hash_shape check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  add constraint public_form_links_sent_to_one check (
    token_hash is null
    or (recipient_email is not null and max_submissions = 1 and content_snapshot is not null)
  ),
  add constraint public_form_links_recipient_email_shape check (
    recipient_email is null
    or (recipient_email = lower(btrim(recipient_email)) and char_length(recipient_email) between 3 and 320)
  ),
  add constraint public_form_links_snapshot_whole check (
    (content_snapshot is null) = (title_snapshot is null)
    and (content_snapshot is null) = (template_revision_snapshot is null)
    and (title_snapshot is null or (title_snapshot = btrim(title_snapshot) and char_length(title_snapshot) between 1 and 200))
  ),
  add constraint public_form_links_snapshots_are_objects check (
    (content_snapshot is null or jsonb_typeof(content_snapshot) = 'object')
    and (answers_snapshot is null or jsonb_typeof(answers_snapshot) = 'object')
  ),
  -- A document that is purged leaves the link, and its answers, in place.
  add constraint public_form_links_document_fkey foreign key (document_id, org_id)
    references public.documents (id, org_id) on delete set null (document_id);

create index public_form_links_document_idx on public.public_form_links (document_id) where document_id is not null;
create index public_form_links_sent_by_idx on public.public_form_links (sent_by) where sent_by is not null;

-- Both functions that find a link by the visitor's token now find a sent link
-- by its hash too; nothing else about them changes.
CREATE OR REPLACE FUNCTION public.submit_public_form_entry(target_public_form_token text, target_public_draft_token text, target_expected_revision integer, target_submission_id uuid, target_title text, target_template_id uuid, target_template_revision integer, target_template_snapshot jsonb, target_values jsonb, target_submitted_at timestamp with time zone)
 RETURNS submissions
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.supersede_public_submission_file(target_public_form_token text, target_public_draft_token text, target_file_id uuid)
 RETURNS submission_files
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
    'bizzflow.public_file_removal_context',
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
    'bizzflow.public_file_removal_context',
    '',
    true
  );

  return locked_file;
end;
$function$;

revoke execute on function public.submit_public_form_entry(text, text, integer, uuid, text, uuid, integer, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.supersede_public_submission_file(text, text, uuid) from public, anon, authenticated;
