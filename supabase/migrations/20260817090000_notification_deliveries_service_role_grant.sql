-- ---------------------------------------------------------------------------
-- Restore the server's privileges on notification_deliveries.
--
-- 20260801090000_sprint_10_notification_deliveries.sql revoked all privileges
-- from `service_role` and then granted only `select` back to `authenticated`.
-- Its own comment says the table is "writable only through the service role",
-- but that role was left with no privileges at all — so every insert from
-- `recordNotificationDelivery` and every read behind the settings activity
-- panel fails with "permission denied for table notification_deliveries".
--
-- BYPASSRLS lets service_role skip the policies; it does not confer table
-- privileges. The sibling migrations grant explicitly for exactly this reason:
-- audit_logs (20260708174500:42) and tasks / task_reminders
-- (20260730090000:143-144).
--
-- No update grant: a delivery attempt is an append-only record of what
-- happened, and nothing in the service edits one after it is written.
-- ---------------------------------------------------------------------------

grant select, insert on table public.notification_deliveries to service_role;

notify pgrst, 'reload schema';
