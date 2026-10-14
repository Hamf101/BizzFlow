-- Cancel signing ("Edit and resend").
--
-- While a document awaits signatures its sender may take it back to edit:
-- every signer's link is revoked, the answers return to a draft, and the
-- document can be sent again to a new round. Expand only: one nullable
-- column, one new function, a partial index in place of a full one, and
-- redefinitions that ignore revoked signers.
--
-- 1. document_signing_recipients.revoked_at: set once, when the round the
--    signer belonged to was cancelled. A revoked signer is no longer the
--    document's; their row (and a signature, as evidence) stays.
-- 2. cancel_document_signing takes the answer row's lock, the lock
--    complete_document_recipient_signature takes first, so a signature
--    landing at the same moment either completes the document before it
--    (the cancel is then refused) or finds its link revoked.
-- 3. One email may be signed again on the same document once its earlier
--    row is revoked: the unique index becomes partial.
-- 4. prevent_retention_evidence_mutation, from its latest version in
--    20260726002558_private_document_access_lifecycle, lets a signed row be
--    revoked once and still refuses every other change.
-- 5. prevent_document_snapshot_mutation (latest: 20261010164708_template_trash),
--    merge_generated_document_answers and complete_document_recipient_signature
--    (latest: 20261011000912_visibility_rules_and_expected_answers) count only
--    signers who are not revoked; nothing else in them changes.
--
-- `create or replace` keeps each redefined function's grants.

alter table public.document_signing_recipients
  add column revoked_at timestamptz;

drop index public.document_signing_recipients_document_email_unique;
create unique index document_signing_recipients_document_email_unique
  on public.document_signing_recipients (document_id, lower(email))
  where revoked_at is null;

create function public.cancel_document_signing(
  target_org_id uuid,
  target_document_id uuid
)
returns table (id uuid, name text, email text, status text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  answer_status text;
begin
  select answer.workflow_status
  into answer_status
  from public.document_answers answer
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Generated document answers were not found.'
      using errcode = 'P0002';
  end if;

  if answer_status <> 'awaiting_signatures' then
    raise exception 'Only a document awaiting signatures can be taken back.'
      using errcode = '23514';
  end if;

  update public.document_answers answer
  set workflow_status = 'draft'
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id;

  return query
  update public.document_signing_recipients recipient
  set revoked_at = now()
  where recipient.document_id = target_document_id
    and recipient.org_id = target_org_id
    and recipient.revoked_at is null
  returning recipient.id, recipient.name, recipient.email, recipient.status;
end;
$$;
revoke all on function public.cancel_document_signing(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_document_signing(uuid, uuid)
  to service_role;

create or replace function private.prevent_retention_evidence_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_retention_state text;
  new_retention_state text;
  signed_user_cleanup boolean := false;
begin
  if new.org_id is distinct from old.org_id
      or new.document_id is distinct from old.document_id then
    raise exception 'Document retention evidence identity is immutable.'
      using errcode = '23514';
  end if;

  old_retention_state := case tg_table_name
    when 'document_answers' then to_jsonb(old) ->> 'workflow_status'
    else to_jsonb(old) ->> 'status'
  end;
  new_retention_state := case tg_table_name
    when 'document_answers' then to_jsonb(new) ->> 'workflow_status'
    else to_jsonb(new) ->> 'status'
  end;

  if tg_table_name = 'document_signing_recipients'
      and old_retention_state = 'signed' then
    signed_user_cleanup :=
      old.user_id is not null
      and new.user_id is null
      and not exists (
        select 1
        from public.profiles old_profile
        where old_profile.id = old.user_id
      );

    -- Revoking a signer, once, is the only other change: their signature
    -- stays as evidence of what they signed before the sender cancelled.
    if (
      to_jsonb(new) - 'user_id' - 'revoked_at'
    ) is distinct from (
      to_jsonb(old) - 'user_id' - 'revoked_at'
    ) or (
      new.revoked_at is distinct from old.revoked_at
      and (old.revoked_at is not null or new.revoked_at is null)
    ) or (
      new.user_id is distinct from old.user_id
      and not signed_user_cleanup
    ) then
      raise exception 'Signed recipient evidence is immutable.'
        using errcode = '23514';
    end if;
  elsif old_retention_state in ('completed', 'finalized')
      and new_retention_state is distinct from old_retention_state then
    raise exception 'Completed and finalized evidence state is immutable.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_document_snapshot_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(new.source_kind, new.template_id, new.template_revision)
      is distinct from
      row(old.source_kind, old.template_id, old.template_revision)
    and not (
      new.source_kind is not distinct from old.source_kind
      and old.template_id is not null
      and new.template_id is null
      and new.template_revision is null
      and exists (
        select 1
        from public.document_templates template
        where template.id = old.template_id
          and template.org_id = old.org_id
          and template.trashed_at is not null
      )
    ) then
    raise exception 'Generated document source snapshots are immutable.'
      using errcode = '23514';
  end if;

  if new.template_snapshot is distinct from old.template_snapshot
    and (
      old.source_kind is distinct from 'generated'
      or exists (
        select 1
        from public.document_answers answer
        where answer.document_id = old.id
          and answer.workflow_status <> 'draft'
      )
      or exists (
        select 1
        from public.document_signing_recipients recipient
        where recipient.document_id = old.id
          and recipient.revoked_at is null
      )
    ) then
    raise exception 'Generated document source snapshots are immutable.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.merge_generated_document_answers(
  target_org_id uuid,
  target_document_id uuid,
  target_values jsonb,
  target_expected_values jsonb default null
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

  -- A drawn box takes an answer only when it is the sender's, and only until
  -- the document is sent.
  if exists (
    select 1
    from jsonb_each(target_values) entry
    join jsonb_array_elements(
      coalesce(document_snapshot -> 'blocks', '[]'::jsonb)
    ) blocks(block)
      on block ->> 'fieldKey' = entry.key
    where block ->> 'type' in ('signature_field', 'initials_field')
      and block ->> 'signer' is distinct from 'sender'
  ) then
    raise exception 'Only the sender''s own box takes a drawing.'
      using errcode = '22023';
  end if;

  if exists (
      select 1
      from jsonb_each(target_values) entry
      join jsonb_array_elements(
        coalesce(document_snapshot -> 'blocks', '[]'::jsonb)
      ) blocks(block)
        on block ->> 'fieldKey' = entry.key
      where block ->> 'type' in ('signature_field', 'initials_field')
    )
    and (
      existing_workflow_status <> 'draft'
      or exists (
        select 1
        from public.document_signing_recipients recipient
        where recipient.document_id = target_document_id
          and recipient.org_id = target_org_id
          and recipient.revoked_at is null
      )
    ) then
    raise exception 'This document was sent for signing, so the sender''s signature can no longer change.'
      using errcode = '23514';
  end if;

  -- Persist the pre-patch prune separately so the row trigger can distinguish a
  -- genuinely re-supplied value from an unchanged, formerly hidden value.
  merged_values := private.prune_template_scalar_values(
    document_snapshot,
    existing_values
  );

  if target_expected_values is not null
      and merged_values is distinct from private.prune_template_scalar_values(
        document_snapshot,
        target_expected_values
      ) then
    raise exception 'Document answers changed since they were read.'
      using errcode = '40001';
  end if;

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
  target_initials_data jsonb,
  target_expected_values jsonb default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  patch_entry record;
  answer_values jsonb;
  persisted_answer_values jsonb;
  answer_status text;
  document_snapshot jsonb;
  document_lifecycle_state public.resource_lifecycle_state;
  matching_block jsonb;
  others_signed boolean;
  merged_values jsonb;
  visible_block_ids jsonb;
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

  select document.template_snapshot, document.lifecycle_state
  into document_snapshot, document_lifecycle_state
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
    and recipient.revoked_at is null
  for update;

  if not found then
    raise exception 'Document signing recipient was not found.'
      using errcode = 'P0002';
  end if;

  if recipient_status = 'signed' then
    return answer_status;
  end if;

  if document_lifecycle_state <> 'active' then
    raise exception 'Only active documents may be modified.'
      using errcode = 'P0001';
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

  if target_expected_values is not null
      and answer_values is distinct from private.prune_template_scalar_values(
        document_snapshot,
        target_expected_values
      ) then
    raise exception 'Document answers changed since they were read.'
      using errcode = '40001';
  end if;

  if answer_values is distinct from persisted_answer_values then
    update public.document_answers answer
    set values = answer_values
    where answer.document_id = target_document_id
      and answer.org_id = target_org_id;
  end if;

  -- Under the answer row's lock: once someone else has signed, an answer that
  -- had a value stays as they signed it. A drawn box is never an answer; each
  -- signer's drawing is kept on their own recipient row.
  others_signed := exists (
    select 1
    from public.document_signing_recipients recipient
    where recipient.document_id = target_document_id
      and recipient.org_id = target_org_id
      and recipient.id <> target_recipient_id
      and recipient.status = 'signed'
      and recipient.revoked_at is null
  );

  for patch_entry in
    select entry.key, entry.value
    from jsonb_each(target_values) entry
  loop
    select block
    into matching_block
    from jsonb_array_elements(
      coalesce(document_snapshot -> 'blocks', '[]'::jsonb)
    ) blocks(block)
    where block ->> 'fieldKey' = patch_entry.key
    limit 1;

    if matching_block is null
        or matching_block ->> 'type' in ('file_field', 'signature_field', 'initials_field') then
      raise exception 'Document answer % is not an answerable field.', patch_entry.key
        using errcode = '22023';
    end if;

    if not private.template_answer_has_valid_shape(matching_block, patch_entry.value) then
      raise exception 'Document answer % does not fit its field.', patch_entry.key
        using errcode = '22023';
    end if;

    if others_signed
        and coalesce(answer_values -> patch_entry.key, 'null'::jsonb) not in ('null'::jsonb, '""'::jsonb)
        and answer_values -> patch_entry.key is distinct from patch_entry.value then
      raise exception 'Someone has already signed. Send it again to change the answers.'
        using errcode = '23514';
    end if;
  end loop;

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
      and recipient.revoked_at is null
  ) then
    visible_block_ids := private.template_visible_block_ids(
      document_snapshot,
      merged_values
    );

    for required_block in
      select block
      from jsonb_array_elements(
        coalesce(document_snapshot -> 'blocks', '[]'::jsonb)
      ) as required_blocks(block)
      where coalesce((block ->> 'required')::boolean, false)
        and block ->> 'type' not in ('signature_field', 'initials_field')
        and visible_block_ids ? (block ->> 'id')
    loop
      required_field_key := required_block ->> 'fieldKey';

      if required_field_key is null or required_field_key = '' then
        raise exception 'Generated document snapshot contains an invalid required field.'
          using errcode = '23514';
      end if;

      if not private.template_answer_is_complete(
        required_block,
        merged_values -> required_field_key
      ) then
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
      and recipient.revoked_at is null
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
