-- ---------------------------------------------------------------------------
-- Let the automatic-reminder sync tell its own bookkeeping apart from a
-- member's decision.
--
-- `unique (task_id, recipient_user_id, remind_at)`
-- (20260730090000_sprint_9_tasks_reminders.sql:65) is status-blind, so a row
-- the sync had already cancelled still occupied the key and blocked a new
-- insert for the same instant. `syncAutomaticTaskReminder` therefore returned
-- early whenever any row matched, and an assignee lost their reminder for good
-- in three ordinary flows:
--
--   * reassign A -> B -> A
--   * unassign, then reassign the same member
--   * move the due date D -> D2 -> D
--
-- The early return could not simply be dropped: without it the re-insert
-- violates the unique key. And it could not filter on `status <> 'cancelled'`
-- either, because a member cancelling an automatic reminder by hand is
-- supposed to stick (see reminder-service.ts cancelTaskReminder).
--
-- `superseded` is the missing distinction. The sync marks the rows it displaces
-- `superseded` and revives one in place when the same instant comes back, while
-- `cancelled` stays what it always was: someone chose to stop this reminder.
--
-- Delivery is unaffected: the scanner filters `status = 'pending'`, as does
-- `task_reminders_due_pending_idx`, so a superseded row is never sent.
-- ---------------------------------------------------------------------------

alter table public.task_reminders
  drop constraint if exists task_reminders_status_check;

alter table public.task_reminders
  add constraint task_reminders_status_check
    check (status in ('pending', 'sent', 'failed', 'cancelled', 'superseded'));

-- The sync revives by (task, recipient, instant); the unique key already covers
-- that lookup. This partial index keeps the revive candidates cheap to find
-- without competing with task_reminders_task_automatic_pending_idx.
create index if not exists task_reminders_task_automatic_superseded_idx
  on public.task_reminders (task_id, recipient_user_id, remind_at)
  where origin = 'automatic' and status = 'superseded';

comment on constraint task_reminders_status_check on public.task_reminders is
  'superseded = displaced by the automatic sync and revivable; cancelled = stopped by a member and final.';

notify pgrst, 'reload schema';
