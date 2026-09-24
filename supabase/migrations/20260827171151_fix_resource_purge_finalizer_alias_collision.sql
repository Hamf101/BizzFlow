-- PL/pgSQL variables share a namespace with query aliases. The previous
-- finalizer declared a `folder_member` record and also used `folder_member` as
-- a relation alias while validating a folder scope. PostgreSQL therefore tried
-- to dereference the not-yet-assigned record instead of the relation alias.
-- Keep the query aliases intact and give the loop record its own unambiguous
-- name.
create or replace function public.finalize_ready_resource_purges(
  target_limit integer
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_job public.resource_purge_jobs%rowtype;
  captured_folder record;
  receipt_id uuid;
  receipt_ids uuid[] := '{}'::uuid[];
  folder_count integer;
  document_count integer;
  object_count integer;
  scope_valid boolean;
  finalized_count integer := 0;
  finalized_at timestamptz;
begin
  if target_limit is null
      or not (target_limit between 1 and 100) then
    raise exception 'Purge finalization limit must be between 1 and 100.'
      using errcode = '22023';
  end if;

  for locked_job in
    select job.*
    from public.resource_purge_jobs job
    where job.status in ('queued', 'processing', 'retry_wait')
      and not exists (
        select 1
        from public.resource_purge_objects object
        where object.job_id = job.id
          and object.status <> 'deleted'
      )
    order by job.org_id, job.requested_at, job.id
    for update skip locked
    limit target_limit
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'folder-tree:' || locked_job.org_id::text,
        0
      )
    );

    select count(*)::integer
    into folder_count
    from public.resource_purge_members member
    where member.job_id = locked_job.id
      and member.resource_kind = 'folder';

    select count(*)::integer
    into document_count
    from public.resource_purge_members member
    where member.job_id = locked_job.id
      and member.resource_kind = 'document';

    select count(*)::integer
    into object_count
    from public.resource_purge_objects object
    where object.job_id = locked_job.id;

    scope_valid := true;

    if locked_job.root_resource_kind = 'document' then
      scope_valid :=
        folder_count = 0
        and document_count = 1
        and exists (
          select 1
          from public.resource_purge_members member
          join public.documents document
            on document.id = member.resource_id
           and document.org_id = member.org_id
          where member.job_id = locked_job.id
            and member.org_id = locked_job.org_id
            and member.resource_kind = 'document'
            and member.resource_id = locked_job.root_resource_id
            and document.lifecycle_state = 'purge_pending'
        );

      if scope_valid
          and locked_job.request_kind = 'automatic'
          and private.document_requires_retention(
            locked_job.org_id,
            locked_job.root_resource_id
          ) then
        scope_valid := false;
      end if;
    else
      with recursive physical_subtree as (
        select folder.id
        from public.folders folder
        where folder.id = locked_job.root_resource_id
          and folder.org_id = locked_job.org_id

        union all

        select child.id
        from physical_subtree parent
        join public.folders child
          on child.parent_folder_id = parent.id
         and child.org_id = locked_job.org_id
      ),
      captured_folders as (
        select member.resource_id as id
        from public.resource_purge_members member
        where member.job_id = locked_job.id
          and member.org_id = locked_job.org_id
          and member.resource_kind = 'folder'
      )
      select
        not exists (
          select id from physical_subtree
          except
          select id from captured_folders
        )
        and not exists (
          select id from captured_folders
          except
          select id from physical_subtree
        )
      into scope_valid;

      scope_valid := coalesce(scope_valid, false)
        and not exists (
          select 1
          from public.resource_purge_members member
          join public.folders folder
            on folder.id = member.resource_id
           and folder.org_id = member.org_id
          where member.job_id = locked_job.id
            and member.resource_kind = 'folder'
            and folder.lifecycle_state <> 'purge_pending'
        )
        and not exists (
          select 1
          from public.resource_purge_members member
          where member.job_id = locked_job.id
            and member.resource_kind = 'folder'
            and not exists (
              select 1
              from public.folders folder
              where folder.id = member.resource_id
                and folder.org_id = member.org_id
            )
        )
        and not exists (
          select document.id
          from public.documents document
          join public.resource_purge_members folder_member
            on folder_member.job_id = locked_job.id
           and folder_member.org_id = document.org_id
           and folder_member.resource_kind = 'folder'
           and folder_member.resource_id = document.folder_id
          where document.org_id = locked_job.org_id
          except
          select member.resource_id
          from public.resource_purge_members member
          where member.job_id = locked_job.id
            and member.org_id = locked_job.org_id
            and member.resource_kind = 'document'
        )
        and not exists (
          select member.resource_id
          from public.resource_purge_members member
          where member.job_id = locked_job.id
            and member.org_id = locked_job.org_id
            and member.resource_kind = 'document'
          except
          select document.id
          from public.documents document
          join public.resource_purge_members folder_member
            on folder_member.job_id = locked_job.id
           and folder_member.org_id = document.org_id
           and folder_member.resource_kind = 'folder'
           and folder_member.resource_id = document.folder_id
          where document.org_id = locked_job.org_id
        )
        and not exists (
          select 1
          from public.resource_purge_members member
          join public.documents document
            on document.id = member.resource_id
           and document.org_id = member.org_id
          where member.job_id = locked_job.id
            and member.resource_kind = 'document'
            and (
              document.lifecycle_state <> 'purge_pending'
              or private.document_requires_retention(
                document.org_id,
                document.id
              )
            )
        );
    end if;

    if not scope_valid then
      update public.resource_purge_jobs job
      set status = 'failed',
          failed_at = coalesce(job.failed_at, now()),
          last_error_code = 'scope_validation_failed',
          lease_token = null,
          lease_expires_at = null
      where job.id = locked_job.id;
      continue;
    end if;

    delete from public.documents document
    using public.resource_purge_members member
    where member.job_id = locked_job.id
      and member.org_id = locked_job.org_id
      and member.resource_kind = 'document'
      and document.id = member.resource_id
      and document.org_id = member.org_id;

    for captured_folder in
      select member.resource_id
      from public.resource_purge_members member
      where member.job_id = locked_job.id
        and member.org_id = locked_job.org_id
        and member.resource_kind = 'folder'
      order by member.depth desc, member.resource_id
    loop
      delete from public.folders folder
      where folder.id = captured_folder.resource_id
        and folder.org_id = locked_job.org_id;

      if not found then
        raise exception 'Captured purge folder disappeared during finalization.'
          using errcode = '23514';
      end if;
    end loop;

    finalized_at := now();
    receipt_id := gen_random_uuid();

    insert into public.resource_purge_tombstones (
      org_id,
      resource_kind,
      resource_id,
      root_job_id,
      purged_at
    )
    select
      member.org_id,
      member.resource_kind,
      member.resource_id,
      locked_job.id,
      finalized_at
    from public.resource_purge_members member
    where member.job_id = locked_job.id;

    delete from public.resource_purge_objects object
    where object.job_id = locked_job.id;

    update public.resource_purge_jobs job
    set status = 'completed',
        completed_at = finalized_at,
        failed_at = null,
        last_error_code = null,
        lease_token = null,
        lease_expires_at = null
    where job.id = locked_job.id;

    insert into public.resource_purge_receipts (
      id,
      job_id,
      org_id,
      root_resource_kind,
      root_resource_id,
      request_kind,
      requested_by,
      object_count,
      document_count,
      folder_count,
      purged_at
    )
    values (
      receipt_id,
      locked_job.id,
      locked_job.org_id,
      locked_job.root_resource_kind,
      locked_job.root_resource_id,
      locked_job.request_kind,
      locked_job.requested_by,
      object_count,
      document_count,
      folder_count,
      finalized_at
    );

    receipt_ids := array_append(receipt_ids, receipt_id);
    finalized_count := finalized_count + 1;
  end loop;

  -- Audit insertion is deliberately the final write in this transaction. The
  -- audit-chain trigger acquires the tenant's final advisory lock.
  insert into public.audit_logs (
    id,
    org_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata,
    created_at
  )
  select
    gen_random_uuid(),
    receipt.org_id,
    receipt.requested_by,
    case receipt.root_resource_kind
      when 'document' then 'document.purged'
      else 'folder.purged'
    end,
    receipt.root_resource_kind,
    receipt.root_resource_id,
    jsonb_build_object(
      'receiptId',
      receipt.id,
      'jobId',
      receipt.job_id,
      'requestKind',
      receipt.request_kind,
      'objectCount',
      receipt.object_count,
      'documentCount',
      receipt.document_count,
      'folderCount',
      receipt.folder_count
    ),
    receipt.purged_at
  from public.resource_purge_receipts receipt
  where receipt.id = any(receipt_ids)
  order by receipt.org_id, receipt.id;

  return finalized_count;
end;
$$;

notify pgrst, 'reload schema';
