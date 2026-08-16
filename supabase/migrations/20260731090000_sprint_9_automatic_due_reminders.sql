-- ---------------------------------------------------------------------------
-- Sprint 9 completion: reminders that follow from a task's due date.
--
-- Until now a reminder only existed if someone opened the task and filled in
-- the manual "Schedule reminder" form, so "assigned users receive reminders for
-- due work" was not true for an ordinary task with a due date.
--
-- `origin` separates the reminders the service maintains from the ones a member
-- scheduled by hand, so syncing a task's due date or assignee never disturbs a
-- manual reminder.
-- ---------------------------------------------------------------------------

alter table public.task_reminders
  add column if not exists origin text not null default 'manual';

alter table public.task_reminders
  drop constraint if exists task_reminders_origin_check;

alter table public.task_reminders
  add constraint task_reminders_origin_check
    check (origin in ('manual', 'automatic'));

-- The reminder channel enum and the Zod contract already carry 'sms', and the
-- task detail form offers it, but the original check only permitted 'email'.
-- Choosing SMS therefore failed with a constraint violation.
alter table public.task_reminders
  drop constraint if exists task_reminders_channel_check;

alter table public.task_reminders
  add constraint task_reminders_channel_check
    check (channel in ('email', 'sms'));

-- Serves the automatic-reminder sync, which reads the pending automatic
-- reminders for one task before deciding what to cancel or insert.
create index if not exists task_reminders_task_automatic_pending_idx
  on public.task_reminders (task_id, recipient_user_id, remind_at)
  where origin = 'automatic' and status = 'pending';

comment on column public.task_reminders.origin is
  'automatic = maintained by the task service from the due date; manual = scheduled by a member.';

notify pgrst, 'reload schema';
