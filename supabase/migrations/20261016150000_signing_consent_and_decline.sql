-- Signing a signer can stand behind: consent, the address signed from, and
-- a way to decline.
--
-- 1. Expand only. Each recipient keeps when they consented to sign
--    electronically and the address they signed from (for the completion
--    certificate), and, when they decline, when and why. 'declined' joins the
--    recipient statuses.
-- 2. complete_document_recipient_signature takes the consent and the address.
--    Both default to null, so code deployed before this migration still signs;
--    an explicit false refuses. A later contract migration can make consent
--    required once every caller sends it.
-- 3. decline_document_signing: a signer with a live link declines with a
--    reason. As cancel_document_signing does, the document goes back to a
--    draft and every link is revoked; signed evidence stays as it was.

alter table public.document_signing_recipients
  add column consented_at timestamptz,
  add column signed_ip text,
  add column declined_at timestamptz,
  add column decline_reason text,
  -- Who sent the round, so a decline reaches them. Null on rounds sent before this.
  add column sent_by uuid references public.profiles (id) on delete set null;

create index document_signing_recipients_sent_by_idx
  on public.document_signing_recipients (sent_by) where sent_by is not null;

alter table public.document_signing_recipients
  drop constraint document_signing_recipients_status_check,
  add constraint document_signing_recipients_status_check
    check (status in ('pending', 'viewed', 'signed', 'declined')),
  drop constraint document_signing_recipients_viewed_state,
  add constraint document_signing_recipients_viewed_state
    check (
      (status = 'pending' and viewed_at is null)
      or (status in ('viewed', 'signed', 'declined') and viewed_at is not null)
    ),
  add constraint document_signing_recipients_declined_state
    check (
      (status <> 'declined' and declined_at is null and decline_reason is null)
      or (status = 'declined' and declined_at is not null and char_length(decline_reason) between 1 and 500)
    ),
  add constraint document_signing_recipients_consent_signed
    check (consented_at is null or status = 'signed'),
  add constraint document_signing_recipients_signed_ip_length
    check (signed_ip is null or char_length(signed_ip) between 1 and 64);

drop function public.complete_document_recipient_signature(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb);

create function public.complete_document_recipient_signature(
  target_org_id uuid,
  target_document_id uuid,
  target_recipient_id uuid,
  target_token_hash text,
  target_values jsonb,
  target_signature_data jsonb,
  target_initials_data jsonb,
  target_expected_values jsonb default null,
  target_consented boolean default null,
  target_ip text default null
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

  -- Null is a caller from before consent was asked; only an explicit no refuses.
  if target_consented is false then
    raise exception 'Consent to sign electronically is required.'
      using errcode = '22023';
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
      initials_data = target_initials_data,
      consented_at = case when target_consented then now() end,
      signed_ip = left(nullif(btrim(target_ip), ''), 64)
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
revoke all on function public.complete_document_recipient_signature(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, boolean, text)
  from public, anon, authenticated;
grant execute on function public.complete_document_recipient_signature(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, boolean, text)
  to service_role;

create function public.decline_document_signing(
  target_org_id uuid,
  target_document_id uuid,
  target_recipient_id uuid,
  target_token_hash text,
  target_reason text
)
returns table (id uuid, name text, email text, status text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  answer_status text;
  document_lifecycle_state public.resource_lifecycle_state;
  reason text := btrim(coalesce(target_reason, ''));
  recipient_status text;
  recipient_token_expires_at timestamptz;
begin
  if char_length(reason) not between 1 and 500 then
    raise exception 'Say why you are declining, in up to 500 characters.'
      using errcode = '22023';
  end if;

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

  select recipient.status, recipient.token_expires_at
  into recipient_status, recipient_token_expires_at
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

  if recipient_status = 'signed' or answer_status <> 'awaiting_signatures' then
    raise exception 'Only a signer who has not signed may decline.'
      using errcode = '23514';
  end if;

  if recipient_token_expires_at <= now() then
    raise exception 'Document signing token has expired.'
      using errcode = 'P0001';
  end if;

  select document.lifecycle_state
  into document_lifecycle_state
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id;

  if document_lifecycle_state is distinct from 'active' then
    raise exception 'Only active documents may be modified.'
      using errcode = 'P0001';
  end if;

  update public.document_signing_recipients recipient
  set status = 'declined',
      viewed_at = coalesce(recipient.viewed_at, now()),
      declined_at = now(),
      decline_reason = reason
  where recipient.id = target_recipient_id
    and recipient.document_id = target_document_id
    and recipient.org_id = target_org_id;

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
revoke all on function public.decline_document_signing(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.decline_document_signing(uuid, uuid, uuid, text, text)
  to service_role;
