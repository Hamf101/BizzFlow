create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open',
  due_at timestamptz,
  assigned_to uuid references public.profiles (id) on delete set null,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz,
  submission_id uuid references public.submissions (id) on delete set null,
  created_by uuid not null references public.profiles (id),
  updated_by uuid not null references public.profiles (id),
  completed_at timestamptz,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  constraint tasks_title_trimmed_length
    check (title = btrim(title) and char_length(title) between 1 and 200),
  constraint tasks_description_length
    check (
      description is null
      or char_length(description) between 1 and 5000
    ),
  constraint tasks_status_check
    check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  constraint tasks_revision_positive
    check (revision > 0),
  constraint tasks_assignment_state_check
    check (
      (
        assigned_to is null
        and assigned_by is null
        and assigned_at is null
      )
      or
      (
        assigned_to is not null
        and assigned_by is not null
        and assigned_at is not null
      )
    ),
  constraint tasks_completion_state_check
    check (
      (status = 'completed' and completed_at is not null)
      or (status <> 'completed' and completed_at is null)
    )
);

create table public.task_reminders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null,
  recipient_user_id uuid not null references public.profiles (id),
  remind_at timestamptz not null,
  channel text not null default 'email',
  status text not null default 'pending',
  attempt_count integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, recipient_user_id, remind_at),
  constraint task_reminders_task_id_org_id_fkey
    foreign key (task_id, org_id)
    references public.tasks (id, org_id)
    on delete cascade,
  constraint task_reminders_channel_check
    check (channel in ('email')),
  constraint task_reminders_status_check
    check (status in ('pending', 'sent', 'failed', 'cancelled')),
  constraint task_reminders_attempt_count_check
    check (attempt_count >= 0),
  constraint task_reminders_last_error_length
    check (
      last_error is null
      or char_length(last_error) between 1 and 500
    ),
  constraint task_reminders_sent_state_check
    check (
      (status = 'sent' and sent_at is not null)
      or (status <> 'sent' and sent_at is null)
    )
);

create index tasks_org_status_idx
  on public.tasks (org_id, status);

create index tasks_org_assigned_to_idx
  on public.tasks (org_id, assigned_to);

create index tasks_org_due_at_idx
  on public.tasks (org_id, due_at);

create index tasks_submission_id_idx
  on public.tasks (submission_id);

create index tasks_assigned_to_idx
  on public.tasks (assigned_to)
  where assigned_to is not null;

create index tasks_assigned_by_idx
  on public.tasks (assigned_by)
  where assigned_by is not null;

create index tasks_created_by_idx
  on public.tasks (created_by);

create index tasks_updated_by_idx
  on public.tasks (updated_by);

create index task_reminders_due_pending_idx
  on public.task_reminders (remind_at)
  where status = 'pending';

create index task_reminders_org_idx
  on public.task_reminders (org_id);

create index task_reminders_task_id_idx
  on public.task_reminders (task_id);

create index task_reminders_recipient_user_id_idx
  on public.task_reminders (recipient_user_id);

create index task_reminders_created_by_idx
  on public.task_reminders (created_by);

alter table public.tasks enable row level security;
alter table public.tasks force row level security;
alter table public.task_reminders enable row level security;
alter table public.task_reminders force row level security;

revoke all on table public.tasks
  from public, anon, authenticated, service_role;
revoke all on table public.task_reminders
  from public, anon, authenticated, service_role;

grant select on table public.tasks to authenticated;
grant select on table public.task_reminders to authenticated;

grant select, insert, update on table public.tasks to service_role;
grant select, insert, update on table public.task_reminders to service_role;

create policy tasks_select_internal_member
  on public.tasks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_memberships membership
      where membership.org_id = tasks.org_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and membership.role in ('owner_admin', 'manager', 'staff')
    )
  );

create policy task_reminders_select_internal_member
  on public.task_reminders
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_memberships membership
      where membership.org_id = task_reminders.org_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and membership.role in ('owner_admin', 'manager', 'staff')
    )
  );

comment on table public.tasks is
  'Tenant-scoped work items with an open/in_progress/completed/cancelled lifecycle.';

comment on column public.tasks.revision is
  'Optimistic concurrency token advanced by every substantive service update.';

comment on column public.tasks.submission_id is
  'Optional originating submission. The link is cleared if the submission is removed.';

comment on table public.task_reminders is
  'Scheduled task reminder deliveries. The natural key makes replayed runs idempotent.';

comment on column public.task_reminders.last_error is
  'User-safe failure reason only. Never store raw provider payloads or recipients.';

notify pgrst, 'reload schema';
