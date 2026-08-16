-- ---------------------------------------------------------------------------
-- Sprint 10 completion: organization notification settings and a durable
-- record of every delivery attempt.
--
-- Before this, notification state existed only per member. There was no
-- organization-level switch, and a send that failed left no trace anywhere:
-- the SMS providers report failure by RETURNING {success:false} rather than
-- throwing, so a discarded result vanished silently and nothing could retry it.
-- ---------------------------------------------------------------------------

-- Organization-level switches. Both default to on so existing tenants keep
-- their current behaviour. These gate the member preference rather than
-- replacing it: a channel must be enabled at BOTH levels to send.
alter table public.organizations
  add column if not exists email_notifications_enabled boolean not null default true,
  add column if not exists sms_notifications_enabled boolean not null default true;

comment on column public.organizations.email_notifications_enabled is
  'Organization-wide email switch. A member preference cannot re-enable a channel the organization disabled.';
comment on column public.organizations.sms_notifications_enabled is
  'Organization-wide SMS switch. A member preference cannot re-enable a channel the organization disabled.';

-- ---------------------------------------------------------------------------
-- notification_deliveries
--
-- Deliberately stores NO message body, phone number, or email address. The
-- recipient is referenced by user id and the content by a purpose label, which
-- is all an operator needs to answer "did this go out, and if not why".
-- ---------------------------------------------------------------------------
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  recipient_user_id uuid references public.profiles (id) on delete set null,
  channel text not null,
  purpose text not null,
  reference text not null,
  status text not null,
  attempt_count integer not null default 1,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  constraint notification_deliveries_channel_check
    check (channel in ('email', 'sms')),
  constraint notification_deliveries_status_check
    check (status in ('sent', 'failed', 'suppressed')),
  constraint notification_deliveries_purpose_check
    check (
      purpose = btrim(purpose)
      and char_length(purpose) between 1 and 60
    ),
  constraint notification_deliveries_reference_check
    check (
      reference = btrim(reference)
      and char_length(reference) between 1 and 200
    ),
  constraint notification_deliveries_attempt_count_check
    check (attempt_count >= 0),
  constraint notification_deliveries_last_error_length
    check (
      last_error is null
      or char_length(last_error) between 1 and 500
    ),
  -- A suppressed delivery was never attempted, so it carries no failure text.
  constraint notification_deliveries_state_check
    check (
      (status = 'failed' and last_error is not null)
      or (status = 'suppressed' and last_error is null)
      or status = 'sent'
    )
);

create index notification_deliveries_org_created_idx
  on public.notification_deliveries (org_id, created_at desc);

create index notification_deliveries_org_status_idx
  on public.notification_deliveries (org_id, status);

create index notification_deliveries_recipient_idx
  on public.notification_deliveries (recipient_user_id)
  where recipient_user_id is not null;

create index notification_deliveries_reference_idx
  on public.notification_deliveries (org_id, reference);

alter table public.notification_deliveries enable row level security;
alter table public.notification_deliveries force row level security;

revoke all on table public.notification_deliveries
  from public, anon, authenticated, service_role;

grant select on table public.notification_deliveries to authenticated;

-- Delivery history is operational evidence, so it is readable by the roles that
-- can already read the audit log, and writable only through the service role.
create policy notification_deliveries_select_manager
  on public.notification_deliveries
  for select
  to authenticated
  using (
    public.organization_role_for(org_id) in ('owner_admin', 'manager')
  );

comment on table public.notification_deliveries is
  'One row per notification delivery attempt. Holds no message content, phone number, or email address.';

notify pgrst, 'reload schema';
