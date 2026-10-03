-- Signature box follow-ups.
--
-- 1. prepare_generated_document_finalization, from
--    20260718070000_generated_document_finalizations, discards a PENDING
--    finalization whose render-input hash differs from the caller's before
--    preparing. One prepared before signers were ordered by signer number
--    (they were ordered by invited_at, which a resend rewrites) could never be
--    promoted: every retry failed its hash check. The service gives the fresh
--    attempt a new id, so its create-only object gets a new key. A finalized
--    row is never touched. The service role holds no delete on the table, so
--    the function now runs as its owner; only the service role may call it.
-- 2. list_unfinalized_generated_documents lists completed, active generated
--    documents with no finalized PDF, for the scheduled sweep that finalizes
--    those completed before finalizing moved to the last signature, or whose
--    finalizing failed then.
--
-- complete_document_recipient_signature checks no initials drawing (the
-- service requires one only from the signer whose required initials box it
-- is), so it is unchanged. `create or replace` keeps each function's grants.

create or replace function public.prepare_generated_document_finalization(
  target_org_id uuid,
  target_document_id uuid,
  target_finalization_id uuid,
  target_storage_key text,
  target_render_input_sha256 text,
  target_created_by uuid
)
returns table (
  id uuid,
  status text,
  storage_key text,
  render_input_sha256 text,
  pdf_sha256 text,
  byte_size bigint,
  document_version_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  answer_status text;
  document_source_kind text;
  document_archived_at timestamptz;
  expected_storage_key text;
  prepared_finalization public.generated_document_finalizations%rowtype;
begin
  if target_org_id is null
      or target_document_id is null
      or target_finalization_id is null
      or target_created_by is null then
    raise exception 'Finalization identifiers are required.'
      using errcode = '22023';
  end if;

  if target_render_input_sha256 is null
      or target_render_input_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Finalization input hash is invalid.'
      using errcode = '22023';
  end if;

  expected_storage_key :=
    'organizations/' || target_org_id::text ||
    '/documents/' || target_document_id::text ||
    '/finalizations/' || target_finalization_id::text ||
    '/final.pdf';

  if target_storage_key is distinct from expected_storage_key then
    raise exception 'Finalization storage key is invalid.'
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

  if answer_status <> 'completed' then
    raise exception 'Generated document is not ready to finalize.'
      using errcode = 'P0001';
  end if;

  select document.source_kind, document.archived_at
  into document_source_kind, document_archived_at
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
  for update;

  if not found or document_source_kind <> 'generated' then
    raise exception 'Generated document was not found.'
      using errcode = 'P0002';
  end if;

  if document_archived_at is not null then
    raise exception 'Archived documents cannot be finalized.'
      using errcode = 'P0001';
  end if;

  -- A pending attempt prepared from other input never completes: its hash
  -- check fails on every retry. Only a pending one is discarded; a finalized
  -- row is immutable and is joined or refused below as before.
  delete from public.generated_document_finalizations finalization
  where finalization.document_id = target_document_id
    and finalization.org_id = target_org_id
    and finalization.status = 'pending'
    and finalization.render_input_sha256 <> target_render_input_sha256;

  insert into public.generated_document_finalizations (
    id,
    org_id,
    document_id,
    status,
    storage_key,
    render_input_sha256,
    created_by
  )
  values (
    target_finalization_id,
    target_org_id,
    target_document_id,
    'pending',
    target_storage_key,
    target_render_input_sha256,
    target_created_by
  )
  on conflict (document_id) do nothing;

  select finalization.*
  into prepared_finalization
  from public.generated_document_finalizations finalization
  where finalization.document_id = target_document_id
    and finalization.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Generated document finalization could not be prepared.'
      using errcode = 'P0002';
  end if;

  -- A concurrent request may have won the one-row-per-document insert with a
  -- different candidate id. Join that row when the immutable render input is
  -- identical; its storage key is already enforced by the table constraint.
  if prepared_finalization.render_input_sha256 <> target_render_input_sha256 then
    raise exception 'Finalization input does not match the prepared record.'
      using errcode = '23514';
  end if;

  return query
  select
    prepared_finalization.id,
    prepared_finalization.status,
    prepared_finalization.storage_key,
    prepared_finalization.render_input_sha256,
    prepared_finalization.pdf_sha256,
    prepared_finalization.byte_size,
    prepared_finalization.document_version_id,
    prepared_finalization.created_at;
end;
$$;

create or replace function public.list_unfinalized_generated_documents(
  target_limit integer
)
returns table (
  org_id uuid,
  document_id uuid,
  created_by uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  select document.org_id, document.id, document.created_by
  from public.documents document
  join public.document_answers answer
    on answer.document_id = document.id
    and answer.org_id = document.org_id
  where document.source_kind = 'generated'
    and document.lifecycle_state = 'active'
    and document.archived_at is null
    and document.created_by is not null
    and answer.workflow_status = 'completed'
    and not exists (
      select 1
      from public.generated_document_finalizations finalization
      where finalization.document_id = document.id
        and finalization.status = 'finalized'
    )
  -- ponytail: random order, so a document that keeps failing cannot hold the
  -- batch; record failed attempts and skip them if many ever pile up.
  order by random()
  limit least(greatest(coalesce(target_limit, 1), 1), 100);
$$;

revoke all on function public.list_unfinalized_generated_documents(integer)
  from public, anon, authenticated;

grant execute on function public.list_unfinalized_generated_documents(integer)
  to service_role;
