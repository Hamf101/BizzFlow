-- Release hardening: reminder delivery idempotency and the nightly purge.
--
-- 1. A notification delivery is recorded `sent` at most once per
--    (tenant, channel, reference). The task services check this ledger before
--    sending, so a retried background run or a lost outcome write does not
--    send again; the index makes a racing second `sent` row impossible.
--    Earlier duplicates (the very bug) keep their history: every copy after
--    the first gets its id appended to its reference.
-- 2. enqueue_due_resource_purges skips — and warns about — any candidate whose
--    queueing fails, instead of failing the whole nightly run on one P0001.
-- 3. restore_document / restore_folder refuse while the parent folder is
--    trashed or purge-pending, which is how an active item ended up inside a
--    trashed folder and blocked that folder's purge. An archived parent still
--    holds active items, as archive_folder never cascades.

with ranked as (
  select
    delivery.id,
    row_number() over (
      partition by delivery.org_id, delivery.channel, delivery.reference
      order by delivery.created_at, delivery.id
    ) as position
  from public.notification_deliveries delivery
  where delivery.status = 'sent'
)
update public.notification_deliveries delivery
set reference = left(delivery.reference, 160) || '#' || delivery.id::text
from ranked
where ranked.id = delivery.id
  and ranked.position > 1;

create unique index notification_deliveries_sent_once_idx
  on public.notification_deliveries (org_id, channel, reference)
  where status = 'sent';

CREATE OR REPLACE FUNCTION public.enqueue_due_resource_purges(target_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  folder_candidate record;
  document_candidate record;
  enqueued_count integer := 0;
begin
  if target_limit is null
      or not (target_limit between 1 and 100) then
    raise exception 'Purge enqueue limit must be between 1 and 100.'
      using errcode = '22023';
  end if;

  for folder_candidate in
    select folder.id, folder.org_id
    from public.folders folder
    where folder.lifecycle_state = 'trashed'
      and folder.purge_after is not null
      and folder.purge_after <= now()
      and folder.trashed_at is not null
      and folder.purge_after >= folder.trashed_at + interval '30 days'
    order by folder.purge_after, folder.id
    for update skip locked
    limit target_limit
  loop
    if exists (
      with recursive physical_subtree as (
        select candidate.id
        from public.folders candidate
        where candidate.id = folder_candidate.id
          and candidate.org_id = folder_candidate.org_id

        union all

        select child.id
        from physical_subtree parent
        join public.folders child
          on child.parent_folder_id = parent.id
         and child.org_id = folder_candidate.org_id
      )
      select 1
      from public.documents document
      where document.org_id = folder_candidate.org_id
        and document.folder_id in (
          select subtree.id from physical_subtree subtree
        )
        and private.document_requires_retention(
          document.org_id,
          document.id
        )
    ) then
      continue;
    end if;

    begin
      perform private.queue_folder_purge(
        gen_random_uuid(),
        folder_candidate.org_id,
        folder_candidate.id,
        'automatic',
        null
      );
      enqueued_count := enqueued_count + 1;
    exception
      when others then
        -- One bad candidate must not fail every other purge tonight.
        raise warning 'enqueue_due_resource_purges skipped % %: % %',
          'folder', folder_candidate.id, sqlstate, sqlerrm;
    end;

    exit when enqueued_count >= target_limit;
  end loop;

  if enqueued_count >= target_limit then
    return enqueued_count;
  end if;

  for document_candidate in
    select document.id, document.org_id
    from public.documents document
    where document.lifecycle_state = 'trashed'
      and document.purge_after is not null
      and document.purge_after <= now()
      and document.trashed_at is not null
      and document.purge_after >= document.trashed_at + interval '30 days'
      and not private.document_requires_retention(
        document.org_id,
        document.id
      )
      and not exists (
        select 1
        from public.document_answers answer
        where answer.org_id = document.org_id
          and answer.document_id = document.id
          and answer.workflow_status = 'completed'
      )
      and not exists (
        select 1
        from public.document_signing_recipients recipient
        where recipient.org_id = document.org_id
          and recipient.document_id = document.id
          and recipient.status = 'signed'
      )
      and not exists (
        select 1
        from public.generated_document_finalizations finalization
        where finalization.org_id = document.org_id
          and finalization.document_id = document.id
          and finalization.status = 'finalized'
      )
    order by document.purge_after, document.id
    for update skip locked
    limit (target_limit - enqueued_count)
  loop
    begin
      perform private.queue_document_purge(
        gen_random_uuid(),
        document_candidate.org_id,
        document_candidate.id,
        'automatic',
        null
      );
      enqueued_count := enqueued_count + 1;
    exception
      when others then
        raise warning 'enqueue_due_resource_purges skipped % %: % %',
          'document', document_candidate.id, sqlstate, sqlerrm;
    end;
  end loop;

  return enqueued_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.restore_document(target_org_id uuid, target_document_id uuid, target_actor_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  actor_role public.organization_role;
  current_lifecycle_state public.resource_lifecycle_state;
  restored_lifecycle_state public.resource_lifecycle_state;
begin
  actor_role := private.require_active_lifecycle_actor(
    target_org_id,
    target_actor_user_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('folder-tree:' || target_org_id::text, 0)
  );

  select
    document.lifecycle_state,
    case
      when document.lifecycle_state = 'archived' then 'active'
      when document.lifecycle_state = 'trashed'
        then document.pre_trash_lifecycle_state
      else null
    end
  into current_lifecycle_state, restored_lifecycle_state
  from public.documents document
  where document.id = target_document_id
    and document.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Document not found.'
      using errcode = 'P0002';
  end if;

  if actor_role not in ('owner_admin', 'manager')
      or private.effective_document_access_level(
        target_org_id,
        target_document_id,
        target_actor_user_id
      ) is distinct from 'contributor'::public.resource_access_level then
    raise exception 'Contributor access and a manager role are required.'
      using errcode = '42501';
  end if;

  if current_lifecycle_state = 'active' then
    return false;
  end if;

  if current_lifecycle_state = 'purge_pending' then
    raise exception 'Purge-pending documents cannot be restored.'
      using errcode = 'P0001';
  end if;

  -- An active document inside a trashed folder would block that folder's
  -- purge every night and reappear with no visible parent.
  if exists (
    select 1
    from public.documents document
    join public.folders parent
      on parent.id = document.folder_id
     and parent.org_id = document.org_id
    where document.id = target_document_id
      and document.org_id = target_org_id
      and parent.lifecycle_state in ('trashed', 'purge_pending')
  ) then
    raise exception 'Restore the containing folder before restoring this document.'
      using errcode = 'P0001';
  end if;

  if restored_lifecycle_state not in ('active', 'archived') then
    raise exception 'Document restore metadata is invalid.'
      using errcode = '23514';
  end if;

  if current_lifecycle_state = 'trashed'
      and exists (
        select 1
        from private.resource_trash_operations operation
        where operation.org_id = target_org_id
          and operation.operation_id = (
            select document.trash_operation_id
            from public.documents document
            where document.id = target_document_id
              and document.org_id = target_org_id
          )
          and operation.root_resource_kind = 'folder'
      ) then
    raise exception 'Restore the containing folder to restore this document.'
      using errcode = 'P0001';
  end if;

  update public.documents document
  set lifecycle_state = restored_lifecycle_state,
      archived_at = case
        when restored_lifecycle_state = 'active' then null
        else document.archived_at
      end,
      archived_by = case
        when restored_lifecycle_state = 'active' then null
        else document.archived_by
      end,
      trashed_by = null,
      trashed_at = null,
      purge_after = null,
      pre_trash_lifecycle_state = null,
      trash_operation_id = null,
      updated_by = target_actor_user_id
  where document.id = target_document_id
    and document.org_id = target_org_id;

  insert into public.document_activity_events (
    id,
    org_id,
    document_id,
    actor_user_id,
    event_type,
    metadata
  )
  values (
    gen_random_uuid(),
    target_org_id,
    target_document_id,
    target_actor_user_id,
    'document.restored',
    jsonb_build_object('restoredState', restored_lifecycle_state)
  );

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.restore_folder(target_org_id uuid, target_folder_id uuid, target_actor_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  actor_role public.organization_role;
  current_lifecycle_state public.resource_lifecycle_state;
  root_trash_operation_id uuid;
  folder_ids uuid[] := '{}'::uuid[];
  document_ids uuid[] := '{}'::uuid[];
  restored_folder_count integer := 0;
  restored_document_count integer := 0;
begin
  actor_role := private.require_active_lifecycle_actor(
    target_org_id,
    target_actor_user_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('folder-tree:' || target_org_id::text, 0)
  );

  select folder.lifecycle_state, folder.trash_operation_id
  into current_lifecycle_state, root_trash_operation_id
  from public.folders folder
  where folder.id = target_folder_id
    and folder.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Folder not found.'
      using errcode = 'P0002';
  end if;

  if actor_role not in ('owner_admin', 'manager')
      or private.effective_folder_access_level(
        target_org_id,
        target_folder_id,
        target_actor_user_id
      ) is distinct from 'contributor'::public.resource_access_level then
    raise exception 'Contributor access and a manager role are required.'
      using errcode = '42501';
  end if;

  if current_lifecycle_state = 'active' then
    return false;
  end if;

  if current_lifecycle_state = 'purge_pending' then
    raise exception 'Purge-pending folders cannot be restored.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.folders folder
    join public.folders parent
      on parent.id = folder.parent_folder_id
     and parent.org_id = folder.org_id
    where folder.id = target_folder_id
      and folder.org_id = target_org_id
      and parent.lifecycle_state in ('trashed', 'purge_pending')
  ) then
    raise exception 'Restore the parent folder before restoring this folder.'
      using errcode = 'P0001';
  end if;

  if current_lifecycle_state = 'archived' then
    update public.folders folder
    set lifecycle_state = 'active',
        archived_at = null,
        archived_by = null,
        trashed_by = null,
        trashed_at = null,
        purge_after = null,
        pre_trash_lifecycle_state = null,
        trash_operation_id = null,
        updated_by = target_actor_user_id
    where folder.id = target_folder_id
      and folder.org_id = target_org_id;

    insert into public.audit_logs (
      org_id,
      actor_user_id,
      action,
      target_type,
      target_id,
      metadata
    )
    values (
      target_org_id,
      target_actor_user_id,
      'folder.restored',
      'folder',
      target_folder_id,
      jsonb_build_object(
        'restoredFolderCount',
        1,
        'restoredDocumentCount',
        0
      )
    );

    return true;
  end if;

  if root_trash_operation_id is null then
    raise exception 'Folder restore metadata is invalid.'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from private.resource_trash_operations operation
    where operation.org_id = target_org_id
      and operation.operation_id = root_trash_operation_id
      and operation.root_resource_kind = 'folder'
      and operation.root_resource_id = target_folder_id
  ) then
    raise exception 'Folder restore operation metadata is invalid.'
      using errcode = '23514';
  end if;

  with recursive restore_subtree as (
    select folder.id
    from public.folders folder
    where folder.id = target_folder_id
      and folder.org_id = target_org_id
      and folder.lifecycle_state = 'trashed'
      and folder.trash_operation_id = root_trash_operation_id

    union all

    select child.id
    from restore_subtree parent
    join public.folders child
      on child.parent_folder_id = parent.id
     and child.org_id = target_org_id
    where child.lifecycle_state = 'trashed'
      and child.trash_operation_id = root_trash_operation_id
  )
  select coalesce(array_agg(subtree.id order by subtree.id), '{}'::uuid[])
  into folder_ids
  from restore_subtree subtree;

  perform folder.id
  from public.folders folder
  where folder.org_id = target_org_id
    and folder.id = any(folder_ids)
  order by folder.id
  for update;

  select coalesce(array_agg(document.id order by document.id), '{}'::uuid[])
  into document_ids
  from public.documents document
  where document.org_id = target_org_id
    and document.folder_id = any(folder_ids)
    and document.lifecycle_state = 'trashed'
    and document.trash_operation_id = root_trash_operation_id;

  perform document.id
  from public.documents document
  where document.org_id = target_org_id
    and document.id = any(document_ids)
  order by document.id
  for update;

  restored_folder_count := coalesce(cardinality(folder_ids), 0);
  restored_document_count := coalesce(cardinality(document_ids), 0);

  update public.documents document
  set lifecycle_state = document.pre_trash_lifecycle_state,
      archived_at = case
        when document.pre_trash_lifecycle_state = 'active' then null
        else document.archived_at
      end,
      archived_by = case
        when document.pre_trash_lifecycle_state = 'active' then null
        else document.archived_by
      end,
      trashed_by = null,
      trashed_at = null,
      purge_after = null,
      pre_trash_lifecycle_state = null,
      trash_operation_id = null,
      updated_by = target_actor_user_id
  where document.org_id = target_org_id
    and document.id = any(document_ids);

  update public.folders folder
  set lifecycle_state = folder.pre_trash_lifecycle_state,
      archived_at = case
        when folder.pre_trash_lifecycle_state = 'active' then null
        else folder.archived_at
      end,
      archived_by = case
        when folder.pre_trash_lifecycle_state = 'active' then null
        else folder.archived_by
      end,
      trashed_by = null,
      trashed_at = null,
      purge_after = null,
      pre_trash_lifecycle_state = null,
      trash_operation_id = null,
      updated_by = target_actor_user_id
  where folder.org_id = target_org_id
    and folder.id = any(folder_ids);

  insert into public.document_activity_events (
    id,
    org_id,
    document_id,
    actor_user_id,
    event_type,
    metadata
  )
  select
    gen_random_uuid(),
    document.org_id,
    document.id,
    target_actor_user_id,
    'document.restored',
    jsonb_build_object(
      'restoredState',
      document.lifecycle_state,
      'trashOperationId',
      root_trash_operation_id
    )
  from public.documents document
  where document.org_id = target_org_id
    and document.id = any(document_ids);

  -- Keep this insert last: the audit-chain trigger takes the transaction's
  -- final advisory lock.
  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    target_org_id,
    target_actor_user_id,
    'folder.restored',
    'folder',
    target_folder_id,
    jsonb_build_object(
      'trashOperationId',
      root_trash_operation_id,
      'restoredFolderCount',
      restored_folder_count,
      'restoredDocumentCount',
      restored_document_count
    )
  );

  return true;
end;
$function$;
