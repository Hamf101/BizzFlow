-- Signature box signers.
--
-- A template assigns each signature or initials box a signer: "sender", or a
-- signer by their place in the order they were added (missing = Signer 1).
--
-- 1. document_signing_recipients.signer_number keeps that place. A resend
--    rewrites invited_at, so it cannot order the signers; the number is given
--    on insert, after the document's highest.
-- 2. merge_generated_document_answers, from its latest version in
--    20260912202419_reconcile_template_visibility_and_role_protection, takes a
--    drawing only for a box assigned to the sender, and only while the
--    document has no signers, under the answer row's lock. A signer's box is
--    never an answer; complete_document_recipient_signature still refuses
--    every drawn box.
--
-- `create or replace` keeps the redefined function's grants.

alter table public.document_signing_recipients
  add column signer_number integer;

-- Numbering existing signers adds to their record and changes none of it,
-- so the signed-evidence guard is paused for this one statement.
alter table public.document_signing_recipients
  disable trigger document_signing_recipients_prevent_retention_evidence_mutation;

update public.document_signing_recipients recipient
set signer_number = numbered.signer_number
from (
  select
    candidate.id,
    row_number() over (
      partition by candidate.document_id
      order by candidate.invited_at, candidate.id
    ) as signer_number
  from public.document_signing_recipients candidate
) numbered
where numbered.id = recipient.id;

alter table public.document_signing_recipients
  enable trigger document_signing_recipients_prevent_retention_evidence_mutation;

create or replace function private.number_document_signer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A row-level BEFORE trigger sees the rows its statement inserted before
  -- this one, so a batch is numbered in the order it was sent.
  select coalesce(max(recipient.signer_number), 0) + 1
  into new.signer_number
  from public.document_signing_recipients recipient
  where recipient.document_id = new.document_id;

  return new;
end;
$$;

revoke all on function private.number_document_signer()
  from public, anon, authenticated, service_role;

drop trigger if exists document_signing_recipients_number_signer
  on public.document_signing_recipients;
create trigger document_signing_recipients_number_signer
  before insert on public.document_signing_recipients
  for each row execute function private.number_document_signer();

-- Concurrent sends that would share a number fail one of them instead.
alter table public.document_signing_recipients
  alter column signer_number set not null,
  add constraint document_signing_recipients_signer_number_positive
    check (signer_number > 0),
  add constraint document_signing_recipients_document_signer_number_key
    unique (document_id, signer_number);

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
