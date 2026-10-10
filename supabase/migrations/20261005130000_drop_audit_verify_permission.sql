-- The audit hash chain went in 20261005120000, so audit_logs:verify gates
-- nothing. Take it out of stored roles first, then out of the allowed list.
-- Code that still names it reads roles tolerantly (unknown permissions are
-- dropped), so this is safe in either deploy order.

update public.organization_roles
set permissions = array_remove(permissions, 'audit_logs:verify')
where 'audit_logs:verify' = any(permissions);

alter table public.organization_roles
  drop constraint organization_roles_permissions_supported;

alter table public.organization_roles
  add constraint organization_roles_permissions_supported
    check (
      permissions is null
      or permissions <@ array[
        'people:view',
        'organization:manage',
        'members:invite',
        'members:update_role',
        'audit_logs:view',
        'templates:view',
        'templates:create',
        'templates:manage',
        'documents:view',
        'documents:send',
        'documents:fill',
        'document_comments:create',
        'documents:create',
        'documents:archive',
        'folders:manage',
        'document_versions:create',
        'submissions:view',
        'submissions:create',
        'submissions:edit',
        'submissions:assign',
        'submissions:review',
        'submission_comments:create',
        'tasks:view',
        'tasks:create',
        'tasks:edit',
        'tasks:assign'
      ]::text[]
    );
