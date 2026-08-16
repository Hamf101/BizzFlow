-- Add notification preference columns to organization_memberships
ALTER TABLE public.organization_memberships
  ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_notifications_enabled boolean NOT NULL DEFAULT true;

-- Ensure PostgREST picks up schema changes
NOTIFY pgrst, 'reload schema';
