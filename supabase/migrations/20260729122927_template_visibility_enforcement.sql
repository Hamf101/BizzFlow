-- Enforce template-v3 conditional visibility at every database persistence
-- boundary. Version-two snapshots remain unconditional by design.

create or replace function private.template_block_is_visible(
  target_template_snapshot jsonb,
  target_block_id text,
  target_values jsonb
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  snapshot_version text;
  current_block_id text := target_block_id;
  current_block jsonb;
  current_block_index bigint;
  current_match_count integer;
  condition jsonb;
  source_block_id text;
  source_block jsonb;
  source_block_index bigint;
  source_match_count integer;
  source_field_key text;
  effective_source_value jsonb;
  expected_source_value jsonb;
  visited_block_ids text[] := array[]::text[];
begin
  if target_template_snapshot is null
      or jsonb_typeof(target_template_snapshot) <> 'object'
      or target_values is null
      or jsonb_typeof(target_values) <> 'object'
      or target_block_id is null
      or target_block_id = ''
      or jsonb_typeof(target_template_snapshot -> 'blocks') <> 'array' then
    return false;
  end if;

  snapshot_version := target_template_snapshot ->> 'schemaVersion';

  select count(*)
  into current_match_count
  from jsonb_array_elements(
    target_template_snapshot -> 'blocks'
  ) with ordinality blocks(block, block_index)
  where block ->> 'id' = current_block_id;

  if current_match_count <> 1 then
    return false;
  end if;

  select block, block_index
  into current_block, current_block_index
  from jsonb_array_elements(
    target_template_snapshot -> 'blocks'
  ) with ordinality blocks(block, block_index)
  where block ->> 'id' = current_block_id;

  if snapshot_version = '2' then
    return true;
  end if;

  if snapshot_version is distinct from '3' then
    return false;
  end if;

  loop
    if current_block_id = any(visited_block_ids) then
      return false;
    end if;

    visited_block_ids := array_append(visited_block_ids, current_block_id);

    if not current_block ? 'visibleWhen' then
      return true;
    end if;

    if not coalesce(
      current_block ->> 'type' = any(array[
        'text_field',
        'date_field',
        'checkbox_field',
        'dropdown_field',
        'initials_field',
        'signature_field',
        'file_field'
      ]),
      false
    ) then
      return false;
    end if;

    condition := current_block -> 'visibleWhen';

    if jsonb_typeof(condition) <> 'object'
        or not condition ?& array['sourceBlockId', 'operator', 'value']
        or condition - array['sourceBlockId', 'operator', 'value']::text[]
          <> '{}'::jsonb
        or jsonb_typeof(condition -> 'sourceBlockId') <> 'string'
        or jsonb_typeof(condition -> 'operator') <> 'string'
        or condition ->> 'operator' <> 'equals' then
      return false;
    end if;

    source_block_id := condition ->> 'sourceBlockId';
    expected_source_value := condition -> 'value';

    if source_block_id is null or source_block_id = '' then
      return false;
    end if;

    select count(*)
    into source_match_count
    from jsonb_array_elements(
      target_template_snapshot -> 'blocks'
    ) with ordinality blocks(block, block_index)
    where block ->> 'id' = source_block_id;

    if source_match_count <> 1 then
      return false;
    end if;

    select block, block_index
    into source_block, source_block_index
    from jsonb_array_elements(
      target_template_snapshot -> 'blocks'
    ) with ordinality blocks(block, block_index)
    where block ->> 'id' = source_block_id;

    if source_block_index >= current_block_index
        or source_block_id = current_block_id
        or not coalesce(
          source_block ->> 'type' = any(array[
            'checkbox_field',
            'dropdown_field'
          ]),
          false
        )
        or jsonb_typeof(source_block -> 'fieldKey') is distinct from 'string' then
      return false;
    end if;

    source_field_key := source_block ->> 'fieldKey';

    if source_field_key is null or source_field_key = '' then
      return false;
    end if;

    if source_block ->> 'type' = 'checkbox_field' then
      if jsonb_typeof(expected_source_value) is distinct from 'boolean'
          or jsonb_typeof(source_block -> 'checkedByDefault') is distinct from 'boolean' then
        return false;
      end if;

      if target_values ? source_field_key then
        effective_source_value := case
          when jsonb_typeof(target_values -> source_field_key) = 'boolean'
            then target_values -> source_field_key
          else 'false'::jsonb
        end;
      else
        effective_source_value := source_block -> 'checkedByDefault';
      end if;
    else
      if jsonb_typeof(expected_source_value) is distinct from 'string'
          or jsonb_typeof(source_block -> 'options') is distinct from 'array'
          or not exists (
            select 1
            from jsonb_array_elements(source_block -> 'options') option(value)
            where option.value = expected_source_value
          ) then
        return false;
      end if;

      effective_source_value := case
        when target_values ? source_field_key
          and jsonb_typeof(target_values -> source_field_key) = 'string'
          then target_values -> source_field_key
        else '""'::jsonb
      end;
    end if;

    if effective_source_value is distinct from expected_source_value then
      return false;
    end if;

    current_block_id := source_block_id;
    current_block := source_block;
    current_block_index := source_block_index;
  end loop;
end;
$$;

create or replace function private.prune_template_scalar_values(
  target_template_snapshot jsonb,
  target_values jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  answer record;
  matching_block jsonb;
  matching_block_count integer;
  pruned_values jsonb := '{}'::jsonb;
begin
  if target_template_snapshot is null
      or jsonb_typeof(target_template_snapshot) <> 'object'
      or target_values is null
      or jsonb_typeof(target_values) <> 'object'
      or jsonb_typeof(target_template_snapshot -> 'blocks') <> 'array' then
    return pruned_values;
  end if;

  for answer in
    select entry.key, entry.value
    from jsonb_each(target_values) entry
  loop
    select count(*)
    into matching_block_count
    from jsonb_array_elements(
      target_template_snapshot -> 'blocks'
    ) blocks(block)
    where block ->> 'fieldKey' = answer.key;

    if matching_block_count <> 1 then
      continue;
    end if;

    select block
    into matching_block
    from jsonb_array_elements(
      target_template_snapshot -> 'blocks'
    ) blocks(block)
    where block ->> 'fieldKey' = answer.key;

    if not coalesce(
        matching_block ->> 'type' = any(array[
          'text_field',
          'date_field',
          'checkbox_field',
          'dropdown_field',
          'initials_field',
          'signature_field'
        ]),
        false
      )
        or not private.template_block_is_visible(
          target_template_snapshot,
          matching_block ->> 'id',
          target_values
        ) then
      continue;
    end if;

    pruned_values := pruned_values || jsonb_build_object(
      answer.key,
      answer.value
    );
  end loop;

  return pruned_values;
end;
$$;

revoke all on function private.template_block_is_visible(jsonb, text, jsonb)
  from public, anon, authenticated;
revoke all on function private.prune_template_scalar_values(jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function private.template_block_is_visible(jsonb, text, jsonb)
  to service_role;
grant execute on function private.prune_template_scalar_values(jsonb, jsonb)
  to service_role;

create or replace function private.enforce_document_answer_visibility()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  document_snapshot jsonb;
  pre_patch_values jsonb;
  changed_values jsonb;
  removed_key text;
begin
  if new.values is null or jsonb_typeof(new.values) <> 'object' then
    raise exception 'Document answer values must be a JSON object.'
      using errcode = '22023';
  end if;

  select document.template_snapshot
  into document_snapshot
  from public.documents document
  where document.id = new.document_id
    and document.org_id = new.org_id
    and document.source_kind = 'generated';

  if not found then
    raise exception 'Generated document snapshot was not found.'
      using errcode = 'P0002';
  end if;

  if tg_op = 'INSERT' then
    new.values := private.prune_template_scalar_values(
      document_snapshot,
      new.values
    );
    return new;
  end if;

  -- First remove answers that were already hidden in the persisted state. Then
  -- apply only the caller's changed/new keys and prune again under the resulting
  -- controller values. This prevents an unchanged stale answer from reappearing
  -- when a controller changes from hidden to visible.
  pre_patch_values := private.prune_template_scalar_values(
    document_snapshot,
    old.values
  );

  for removed_key in
    select old_entry.key
    from jsonb_each(old.values) old_entry
    where not new.values ? old_entry.key
  loop
    pre_patch_values := pre_patch_values - removed_key;
  end loop;

  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  into changed_values
  from jsonb_each(new.values) entry
  where not old.values ? entry.key
    or old.values -> entry.key is distinct from entry.value;

  new.values := private.prune_template_scalar_values(
    document_snapshot,
    pre_patch_values || changed_values
  );

  return new;
end;
$$;

revoke all on function private.enforce_document_answer_visibility()
  from public, anon, authenticated, service_role;

drop trigger if exists document_answers_apply_template_visibility
  on public.document_answers;
create trigger document_answers_apply_template_visibility
  before insert or update of values on public.document_answers
  for each row execute function private.enforce_document_answer_visibility();

create or replace function private.validate_visible_submission_requirements(
  target_template_snapshot jsonb,
  target_values jsonb,
  target_submission_id uuid,
  target_org_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  required_block jsonb;
  required_field_key text;
  required_value jsonb;
begin
  for required_block in
    select block
    from jsonb_array_elements(
      coalesce(target_template_snapshot -> 'blocks', '[]'::jsonb)
    ) blocks(block)
    where coalesce((block ->> 'required')::boolean, false)
      and private.template_block_is_visible(
        target_template_snapshot,
        block ->> 'id',
        target_values
      )
  loop
    required_field_key := required_block ->> 'fieldKey';

    if required_field_key is null or required_field_key = '' then
      raise exception 'Submission snapshot contains an invalid required field.'
        using errcode = '23514';
    end if;

    if required_block ->> 'type' = 'file_field' then
      if not exists (
        select 1
        from public.submission_files submission_file
        where submission_file.submission_id = target_submission_id
          and submission_file.org_id = target_org_id
          and submission_file.field_key = required_field_key
          and submission_file.status = 'available'
      ) then
        raise exception 'Required submission file % is missing.', required_block ->> 'label'
          using errcode = '22023';
      end if;

      continue;
    end if;

    if not coalesce(
      required_block ->> 'type' = any(array[
        'text_field',
        'date_field',
        'checkbox_field',
        'dropdown_field',
        'initials_field',
        'signature_field'
      ]),
      false
    ) then
      raise exception 'Submission snapshot contains an invalid required field.'
        using errcode = '23514';
    end if;

    required_value := target_values -> required_field_key;

    if required_block ->> 'type' = 'checkbox_field' then
      if required_value is null
          or jsonb_typeof(required_value) <> 'boolean'
          or required_value <> 'true'::jsonb then
        raise exception 'Required submission field % is incomplete.', required_block ->> 'label'
          using errcode = '22023';
      end if;
    elsif required_value is null
        or jsonb_typeof(required_value) <> 'string'
        or btrim(required_value #>> '{}') = '' then
      raise exception 'Required submission field % is incomplete.', required_block ->> 'label'
        using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function private.validate_visible_submission_requirements(
  jsonb,
  jsonb,
  uuid,
  uuid
) from public, anon, authenticated;
grant execute on function private.validate_visible_submission_requirements(
  jsonb,
  jsonb,
  uuid,
  uuid
) to service_role;

create or replace function public.validate_internal_submission_values(
  target_template_snapshot jsonb,
  target_values jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
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

    if jsonb_typeof(answer.value) <> 'string' then
      raise exception 'Submission field % must be text.', answer.key
        using errcode = '22023';
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
          or to_char(to_date(answer_text, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> answer_text
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
$$;

revoke all on function public.validate_internal_submission_values(jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.validate_internal_submission_values(jsonb, jsonb)
  to service_role;

create or replace function private.enforce_submission_visibility()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.validate_internal_submission_values(
    new.template_snapshot,
    new.values
  );

  if new.status = 'submitted' then
    if exists (
      select 1
      from public.submission_files submission_file
      join lateral (
        select block
        from jsonb_array_elements(
          coalesce(new.template_snapshot -> 'blocks', '[]'::jsonb)
        ) blocks(block)
        where block ->> 'type' = 'file_field'
          and block ->> 'fieldKey' = submission_file.field_key
        limit 1
      ) file_field on true
      where submission_file.submission_id = new.id
        and submission_file.org_id = new.org_id
        and submission_file.status = 'upload_pending'
        and private.template_block_is_visible(
          new.template_snapshot,
          file_field.block ->> 'id',
          new.values
        )
    ) then
      raise exception 'Wait for pending file uploads before submitting.'
        using errcode = 'P0001';
    end if;

    perform private.validate_visible_submission_requirements(
      new.template_snapshot,
      new.values,
      new.id,
      new.org_id
    );
  end if;

  return new;
end;
$$;

create or replace function private.cleanup_hidden_submission_files()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.submission_files submission_file
  set status = 'superseded',
      superseded_by = coalesce(new.updated_by, new.created_by, new.submitted_by),
      superseded_at = now(),
      updated_at = now()
  where submission_file.submission_id = new.id
    and submission_file.org_id = new.org_id
    and submission_file.status in ('upload_pending', 'available')
    and not exists (
      select 1
      from jsonb_array_elements(
        coalesce(new.template_snapshot -> 'blocks', '[]'::jsonb)
      ) blocks(block)
      where block ->> 'type' = 'file_field'
        and block ->> 'fieldKey' = submission_file.field_key
        and (
          select count(*)
          from jsonb_array_elements(
            coalesce(new.template_snapshot -> 'blocks', '[]'::jsonb)
          ) matching_blocks(matching_block)
          where matching_block ->> 'fieldKey' = submission_file.field_key
        ) = 1
        and private.template_block_is_visible(
          new.template_snapshot,
          block ->> 'id',
          new.values
        )
    );

  return new;
end;
$$;

revoke all on function private.enforce_submission_visibility()
  from public, anon, authenticated, service_role;
revoke all on function private.cleanup_hidden_submission_files()
  from public, anon, authenticated, service_role;

drop trigger if exists submissions_validate_template_visibility
  on public.submissions;
create trigger submissions_validate_template_visibility
  before insert or update of values, status on public.submissions
  for each row execute function private.enforce_submission_visibility();

drop trigger if exists submissions_cleanup_hidden_files
  on public.submissions;
create trigger submissions_cleanup_hidden_files
  after insert or update of values on public.submissions
  for each row execute function private.cleanup_hidden_submission_files();

create or replace function private.require_visible_submission_file_field()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  submission_snapshot jsonb;
  submission_values jsonb;
  file_block jsonb;
  file_block_count integer;
begin
  if new.status not in ('upload_pending', 'available') then
    return new;
  end if;

  select submission.template_snapshot, submission.values
  into submission_snapshot, submission_values
  from public.submissions submission
  where submission.id = new.submission_id
    and submission.org_id = new.org_id;

  if not found then
    raise exception 'Submission file requires an existing submission.'
      using errcode = '23503';
  end if;

  select count(*)
  into file_block_count
  from jsonb_array_elements(
    coalesce(submission_snapshot -> 'blocks', '[]'::jsonb)
  ) blocks(block)
  where block ->> 'type' = 'file_field'
    and block ->> 'fieldKey' = new.field_key;

  if file_block_count <> 1 then
    raise exception 'Submission file field was not found.'
      using errcode = '22023';
  end if;

  select block
  into file_block
  from jsonb_array_elements(
    coalesce(submission_snapshot -> 'blocks', '[]'::jsonb)
  ) blocks(block)
  where block ->> 'type' = 'file_field'
    and block ->> 'fieldKey' = new.field_key;

  if not private.template_block_is_visible(
    submission_snapshot,
    file_block ->> 'id',
    submission_values
  ) then
    raise exception 'Submission file field is currently hidden.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function private.require_visible_submission_file_field()
  from public, anon, authenticated, service_role;

drop trigger if exists submission_files_require_visible_field
  on public.submission_files;
create trigger submission_files_require_visible_field
  before insert or update of status on public.submission_files
  for each row execute function private.require_visible_submission_file_field();

-- Carry the storage-cleanup transition guard forward unchanged except for one
-- narrow actor-less transition: an active file on an actor-less submission may
-- be superseded only when its field is currently hidden under persisted values.
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

create or replace function public.merge_generated_document_answers(
  target_org_id uuid,
  target_document_id uuid,
  target_values jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing_values jsonb;
  existing_workflow_status text;
  document_snapshot jsonb;
  merged_values jsonb;
begin
  if target_values is null or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Document answer values must be a JSON object.'
      using errcode = '22023';
  end if;

  select answer.values, answer.workflow_status
  into existing_values, existing_workflow_status
  from public.document_answers answer
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Generated document answers were not found.'
      using errcode = 'P0002';
  end if;

  if existing_workflow_status = 'completed' then
    raise exception 'Completed document answers are immutable.'
      using errcode = '23514';
  end if;

  select document.template_snapshot
  into document_snapshot
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
    and document.source_kind = 'generated';

  if not found then
    raise exception 'Generated document snapshot was not found.'
      using errcode = 'P0002';
  end if;

  -- Persist the pre-patch prune separately so the row trigger can distinguish a
  -- genuinely re-supplied value from an unchanged, formerly hidden value.
  merged_values := private.prune_template_scalar_values(
    document_snapshot,
    existing_values
  );

  if merged_values is distinct from existing_values then
    update public.document_answers answer
    set values = merged_values
    where answer.document_id = target_document_id
      and answer.org_id = target_org_id;

    existing_values := merged_values;
  end if;

  merged_values := private.prune_template_scalar_values(
    document_snapshot,
    existing_values || target_values
  );

  update public.document_answers answer
  set values = merged_values
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id
  returning answer.values into existing_values;

  return existing_values;
end;
$$;

create or replace function public.complete_document_recipient_signature(
  target_org_id uuid,
  target_document_id uuid,
  target_recipient_id uuid,
  target_token_hash text,
  target_values jsonb,
  target_signature_data jsonb,
  target_initials_data jsonb
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  answer_values jsonb;
  persisted_answer_values jsonb;
  answer_status text;
  document_snapshot jsonb;
  merged_values jsonb;
  required_block jsonb;
  required_field_key text;
  recipient_requires_signature boolean;
  recipient_status text;
  recipient_token_expires_at timestamptz;
begin
  select answer.values, answer.workflow_status
  into answer_values, answer_status
  from public.document_answers answer
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Generated document answers were not found.'
      using errcode = 'P0002';
  end if;

  if target_values is null or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Document answer values must be a JSON object.'
      using errcode = '22023';
  end if;

  select document.template_snapshot
  into document_snapshot
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
    and document.source_kind = 'generated';

  if not found then
    raise exception 'Generated document snapshot was not found.'
      using errcode = 'P0002';
  end if;

  select recipient.requires_signature, recipient.status, recipient.token_expires_at
  into recipient_requires_signature, recipient_status, recipient_token_expires_at
  from public.document_signing_recipients recipient
  where recipient.id = target_recipient_id
    and recipient.document_id = target_document_id
    and recipient.org_id = target_org_id
    and recipient.token_hash = target_token_hash
  for update;

  if not found then
    raise exception 'Document signing recipient was not found.'
      using errcode = 'P0002';
  end if;

  if recipient_status = 'signed' then
    return answer_status;
  end if;

  if recipient_token_expires_at <= now() then
    raise exception 'Document signing token has expired.'
      using errcode = 'P0001';
  end if;

  if answer_status = 'completed' then
    raise exception 'Completed document answers are immutable.'
      using errcode = '23514';
  end if;

  if recipient_requires_signature and target_signature_data is null then
    raise exception 'A drawn signature is required.'
      using errcode = '22023';
  end if;

  persisted_answer_values := answer_values;
  answer_values := private.prune_template_scalar_values(
    document_snapshot,
    answer_values
  );

  if answer_values is distinct from persisted_answer_values then
    update public.document_answers answer
    set values = answer_values
    where answer.document_id = target_document_id
      and answer.org_id = target_org_id;
  end if;

  merged_values := private.prune_template_scalar_values(
    document_snapshot,
    answer_values || target_values
  );

  if not exists (
    select 1
    from public.document_signing_recipients recipient
    where recipient.document_id = target_document_id
      and recipient.org_id = target_org_id
      and recipient.id <> target_recipient_id
      and recipient.requires_signature
      and recipient.status <> 'signed'
  ) then
    for required_block in
      select block
      from jsonb_array_elements(
        coalesce(document_snapshot -> 'blocks', '[]'::jsonb)
      ) as required_blocks(block)
      where coalesce((block ->> 'required')::boolean, false)
        and block ->> 'type' not in ('signature_field', 'initials_field')
        and private.template_block_is_visible(
          document_snapshot,
          block ->> 'id',
          merged_values
        )
    loop
      required_field_key := required_block ->> 'fieldKey';

      if required_field_key is null or required_field_key = '' then
        raise exception 'Generated document snapshot contains an invalid required field.'
          using errcode = '23514';
      end if;

      if required_block ->> 'type' = 'checkbox_field' then
        if merged_values -> required_field_key is distinct from 'true'::jsonb then
          raise exception 'Required document fields must be completed before the final signature.'
            using errcode = '22023';
        end if;
      elsif jsonb_typeof(merged_values -> required_field_key) is distinct from 'string'
          or btrim(merged_values ->> required_field_key) = '' then
        raise exception 'Required document fields must be completed before the final signature.'
          using errcode = '22023';
      end if;
    end loop;
  end if;

  update public.document_signing_recipients recipient
  set status = 'signed',
      viewed_at = coalesce(recipient.viewed_at, now()),
      signed_at = now(),
      signature_data = target_signature_data,
      initials_data = target_initials_data
  where recipient.id = target_recipient_id
    and recipient.document_id = target_document_id
    and recipient.org_id = target_org_id;

  if exists (
    select 1
    from public.document_signing_recipients recipient
    where recipient.document_id = target_document_id
      and recipient.org_id = target_org_id
      and recipient.requires_signature
      and recipient.status <> 'signed'
  ) then
    answer_status := 'awaiting_signatures';
  else
    answer_status := 'completed';
  end if;

  update public.document_answers answer
  set values = merged_values,
      workflow_status = answer_status
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id;

  return answer_status;
end;
$$;

revoke all on function public.merge_generated_document_answers(
  uuid,
  uuid,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.complete_document_recipient_signature(
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.merge_generated_document_answers(
  uuid,
  uuid,
  jsonb
) to service_role;
grant execute on function public.complete_document_recipient_signature(
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb
) to service_role;

create or replace function public.submit_internal_submission(
  target_org_id uuid,
  target_submission_id uuid,
  target_expected_revision integer,
  target_values jsonb,
  target_actor_user_id uuid
)
returns public.submissions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_submission public.submissions%rowtype;
  previous_status text;
  submission_event_type text;
  audit_action text;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_actor_user_id is null
      or target_expected_revision is null
      or target_expected_revision < 1
      or target_values is null
      or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Valid submission values and revision are required.'
      using errcode = '22023';
  end if;

  perform public.assert_internal_submission_actor(
    target_org_id,
    target_actor_user_id
  );

  select submission.*
  into locked_submission
  from public.submissions submission
  where submission.id = target_submission_id
    and submission.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Submission was not found.'
      using errcode = 'P0002';
  end if;

  if locked_submission.created_by is null
      or locked_submission.created_by <> target_actor_user_id then
    raise exception 'Only the submission creator may submit this draft.'
      using errcode = '42501';
  end if;

  if locked_submission.status = 'submitted' then
    if locked_submission.values = target_values
        and locked_submission.submitted_by = target_actor_user_id then
      return locked_submission;
    end if;

    raise exception 'Submission status cannot be submitted again.'
      using errcode = 'P0001';
  end if;

  if locked_submission.status not in ('draft', 'needs_changes') then
    raise exception 'Submission status cannot be submitted.'
      using errcode = 'P0001';
  end if;

  if locked_submission.revision <> target_expected_revision then
    raise exception 'Submission draft has changed. Reload and try again.'
      using errcode = '40001';
  end if;

  perform public.validate_internal_submission_values(
    locked_submission.template_snapshot,
    target_values
  );

  if exists (
    select 1
    from public.submission_files submission_file
    join lateral (
      select block
      from jsonb_array_elements(
        coalesce(locked_submission.template_snapshot -> 'blocks', '[]'::jsonb)
      ) blocks(block)
      where block ->> 'type' = 'file_field'
        and block ->> 'fieldKey' = submission_file.field_key
      limit 1
    ) file_field on true
    where submission_file.submission_id = target_submission_id
      and submission_file.org_id = target_org_id
      and submission_file.status = 'upload_pending'
      and private.template_block_is_visible(
        locked_submission.template_snapshot,
        file_field.block ->> 'id',
        target_values
      )
  ) then
    raise exception 'Wait for pending file uploads before submitting.'
      using errcode = 'P0001';
  end if;

  perform private.validate_visible_submission_requirements(
    locked_submission.template_snapshot,
    target_values,
    target_submission_id,
    target_org_id
  );

  previous_status := locked_submission.status;
  submission_event_type := case
    when previous_status = 'draft' then 'submitted'
    else 'resubmitted'
  end;
  audit_action := case
    when previous_status = 'draft' then 'submission.submitted'
    else 'submission.resubmitted'
  end;

  update public.submissions submission
  set values = target_values,
      status = 'submitted',
      revision = submission.revision + 1,
      updated_by = target_actor_user_id,
      submitted_by = target_actor_user_id,
      updated_at = now(),
      submitted_at = now()
  where submission.id = target_submission_id
    and submission.org_id = target_org_id
  returning submission.* into locked_submission;

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
    target_org_id,
    target_submission_id,
    target_actor_user_id,
    submission_event_type,
    previous_status,
    'submitted',
    locked_submission.assigned_to,
    locked_submission.revision
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
    target_org_id,
    target_actor_user_id,
    audit_action,
    'submission',
    target_submission_id,
    jsonb_build_object(
      'templateId', locked_submission.template_id,
      'templateRevision', locked_submission.template_revision,
      'submissionRevision', locked_submission.revision
    )
  );

  return locked_submission;
end;
$$;

create or replace function public.allocate_internal_submission_file(
  target_org_id uuid,
  target_submission_id uuid,
  target_expected_revision integer,
  target_file_id uuid,
  target_field_key text,
  target_original_filename text,
  target_safe_filename text,
  target_content_type text,
  target_byte_size bigint,
  target_storage_key text,
  target_expected_checksum_sha256 text,
  target_actor_user_id uuid
)
returns public.submission_files
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_submission public.submissions%rowtype;
  prepared_file public.submission_files%rowtype;
  expected_storage_key text;
  file_block jsonb;
begin
  if target_org_id is null
      or target_submission_id is null
      or target_expected_revision is null
      or target_expected_revision < 1
      or target_file_id is null
      or target_field_key is null
      or target_original_filename is null
      or target_safe_filename is null
      or target_content_type is null
      or target_byte_size is null
      or target_storage_key is null
      or target_expected_checksum_sha256 is null
      or target_expected_checksum_sha256 !~ '^[0-9a-f]{64}$'
      or target_actor_user_id is null then
    raise exception 'Complete submission file metadata is required.'
      using errcode = '22023';
  end if;

  locked_submission := public.lock_editable_internal_submission(
    target_org_id,
    target_submission_id,
    target_actor_user_id
  );

  if locked_submission.revision <> target_expected_revision then
    raise exception 'Submission draft has changed. Reload and try again.'
      using errcode = '40001';
  end if;

  select block
  into file_block
  from jsonb_array_elements(
    coalesce(locked_submission.template_snapshot -> 'blocks', '[]'::jsonb)
  ) blocks(block)
  where block ->> 'type' = 'file_field'
    and block ->> 'fieldKey' = target_field_key
  limit 1;

  if file_block is null then
    raise exception 'Submission file field was not found.'
      using errcode = '22023';
  end if;

  if not private.template_block_is_visible(
    locked_submission.template_snapshot,
    file_block ->> 'id',
    locked_submission.values
  ) then
    raise exception 'Submission file field is currently hidden.'
      using errcode = '22023';
  end if;

  if target_original_filename <> btrim(target_original_filename)
      or char_length(target_original_filename) not between 1 and 240
      or char_length(target_safe_filename) not between 1 and 180
      or target_safe_filename !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
      or target_content_type not in (
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv'
      )
      or target_byte_size not between 1 and 20971520
      or not (case target_content_type
        when 'application/pdf' then lower(target_safe_filename) ~ '\.pdf$'
        when 'image/jpeg' then lower(target_safe_filename) ~ '\.(jpg|jpeg)$'
        when 'image/png' then lower(target_safe_filename) ~ '\.png$'
        when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          then lower(target_safe_filename) ~ '\.docx$'
        when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          then lower(target_safe_filename) ~ '\.xlsx$'
        when 'text/csv' then lower(target_safe_filename) ~ '\.csv$'
        else false
      end) then
    raise exception 'Submission file metadata is invalid.'
      using errcode = '22023';
  end if;

  expected_storage_key :=
    'organizations/' || target_org_id::text ||
    '/submissions/' || target_submission_id::text ||
    '/files/' || target_field_key ||
    '/' || target_file_id::text ||
    '/' || target_safe_filename;

  if target_storage_key is distinct from expected_storage_key then
    raise exception 'Submission file storage key is invalid.'
      using errcode = '22023';
  end if;

  select submission_file.*
  into prepared_file
  from public.submission_files submission_file
  where submission_file.submission_id = target_submission_id
    and submission_file.org_id = target_org_id
    and submission_file.field_key = target_field_key
    and submission_file.status in ('upload_pending', 'available')
  for update;

  if found then
    if prepared_file.id = target_file_id
        and prepared_file.status = 'upload_pending'
        and prepared_file.storage_key = target_storage_key
        and prepared_file.original_filename = target_original_filename
        and prepared_file.safe_filename = target_safe_filename
        and prepared_file.content_type = target_content_type
        and prepared_file.byte_size = target_byte_size
        and prepared_file.expected_checksum_sha256 = target_expected_checksum_sha256
        and prepared_file.uploaded_by = target_actor_user_id then
      return prepared_file;
    end if;

    raise exception 'This submission field already has an active file allocation.'
      using errcode = '23505';
  end if;

  insert into public.submission_files (
    id,
    org_id,
    submission_id,
    field_key,
    status,
    storage_key,
    original_filename,
    safe_filename,
    content_type,
    byte_size,
    expected_checksum_sha256,
    uploaded_by
  )
  values (
    target_file_id,
    target_org_id,
    target_submission_id,
    target_field_key,
    'upload_pending',
    target_storage_key,
    target_original_filename,
    target_safe_filename,
    target_content_type,
    target_byte_size,
    target_expected_checksum_sha256,
    target_actor_user_id
  )
  returning * into prepared_file;

  return prepared_file;
end;
$$;

create or replace function public.supersede_public_submission_file(
  target_public_form_token text,
  target_public_draft_token text,
  target_file_id uuid
)
returns public.submission_files
language plpgsql
security invoker
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
  where public_link.token = target_public_form_token
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
$$;

revoke all on function public.submit_internal_submission(
  uuid,
  uuid,
  integer,
  jsonb,
  uuid
) from public, anon, authenticated, service_role;
revoke all on function public.allocate_internal_submission_file(
  uuid,
  uuid,
  integer,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  text,
  text,
  uuid
) from public, anon, authenticated, service_role;
revoke all on function public.supersede_public_submission_file(
  text,
  text,
  uuid
) from public, anon, authenticated, service_role;

grant execute on function public.submit_internal_submission(
  uuid,
  uuid,
  integer,
  jsonb,
  uuid
) to service_role;
grant execute on function public.allocate_internal_submission_file(
  uuid,
  uuid,
  integer,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  text,
  text,
  uuid
) to service_role;
grant execute on function public.supersede_public_submission_file(
  text,
  text,
  uuid
) to service_role;

-- Existing active file rows that are hidden (or no longer map to exactly one
-- file field) enter the existing bounded superseded-object cleanup lifecycle.
update public.submission_files submission_file
set status = 'superseded',
    superseded_by = coalesce(
      submission.updated_by,
      submission.created_by,
      submission.submitted_by
    ),
    superseded_at = now(),
    updated_at = now()
from public.submissions submission
where submission.id = submission_file.submission_id
  and submission.org_id = submission_file.org_id
  and submission_file.status in ('upload_pending', 'available')
  and coalesce(
    submission.updated_by,
    submission.created_by,
    submission.submitted_by
  ) is not null
  and not exists (
    select 1
    from jsonb_array_elements(
      coalesce(submission.template_snapshot -> 'blocks', '[]'::jsonb)
    ) blocks(block)
    where block ->> 'type' = 'file_field'
      and block ->> 'fieldKey' = submission_file.field_key
      and (
        select count(*)
        from jsonb_array_elements(
          coalesce(submission.template_snapshot -> 'blocks', '[]'::jsonb)
        ) matching_blocks(matching_block)
        where matching_block ->> 'fieldKey' = submission_file.field_key
      ) = 1
      and private.template_block_is_visible(
        submission.template_snapshot,
        block ->> 'id',
        submission.values
      )
  );

notify pgrst, 'reload schema';
