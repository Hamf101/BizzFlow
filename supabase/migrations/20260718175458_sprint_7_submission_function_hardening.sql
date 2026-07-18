create or replace function public.create_internal_submission_draft(
  target_org_id uuid,
  target_template_id uuid,
  target_submission_id uuid,
  target_title text,
  target_actor_user_id uuid
)
returns public.submissions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_template public.document_templates%rowtype;
  prepared_submission public.submissions%rowtype;
  inserted_count integer;
begin
  if target_org_id is null
      or target_template_id is null
      or target_submission_id is null
      or target_actor_user_id is null
      or target_title is null
      or target_title <> btrim(target_title)
      or char_length(target_title) not between 1 and 180 then
    raise exception 'Valid submission identifiers and title are required.'
      using errcode = '22023';
  end if;

  perform public.assert_internal_submission_actor(
    target_org_id,
    target_actor_user_id
  );

  select template_row.*
  into locked_template
  from public.document_templates template_row
  where template_row.id = target_template_id
    and template_row.org_id = target_org_id
    and template_row.status = 'published'
  for share;

  if not found then
    raise exception 'Published submission template was not found.'
      using errcode = 'P0002';
  end if;

  insert into public.submissions (
    id,
    org_id,
    title,
    template_id,
    template_revision,
    template_snapshot,
    values,
    status,
    revision,
    created_by,
    updated_by
  )
  values (
    target_submission_id,
    target_org_id,
    target_title,
    target_template_id,
    locked_template.revision,
    locked_template.content,
    '{}'::jsonb,
    'draft',
    1,
    target_actor_user_id,
    target_actor_user_id
  )
  on conflict (id) do nothing
  returning * into prepared_submission;

  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    select submission.*
    into prepared_submission
    from public.submissions submission
    where submission.id = target_submission_id
    for update;

    if not found
        or prepared_submission.org_id <> target_org_id
        or prepared_submission.template_id <> target_template_id
        or prepared_submission.title <> target_title
        or prepared_submission.created_by is null
        or prepared_submission.created_by <> target_actor_user_id then
      raise exception 'Submission identifier is already in use.'
        using errcode = '23505';
    end if;

    return prepared_submission;
  end if;

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
    target_org_id,
    target_actor_user_id,
    'submission.created',
    'submission',
    target_submission_id,
    jsonb_build_object(
      'templateId', target_template_id,
      'templateRevision', locked_template.revision
    )
  );

  return prepared_submission;
end;
$$;

revoke all on function public.create_internal_submission_draft(
  uuid,
  uuid,
  uuid,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.create_internal_submission_draft(
  uuid,
  uuid,
  uuid,
  text,
  uuid
) to service_role;

notify pgrst, 'reload schema';
