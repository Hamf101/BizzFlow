alter table public.profiles
  add column if not exists phone_number text;

alter table public.profiles
  drop constraint if exists profiles_phone_number_format;

alter table public.profiles
  add constraint profiles_phone_number_format
    check (
      phone_number is null
      or phone_number ~ '^\+[1-9]\d{1,14}$'
    );

alter table public.task_reminders
  drop constraint if exists task_reminders_channel_check;

alter table public.task_reminders
  add constraint task_reminders_channel_check
    check (channel in ('email', 'sms'));

comment on column public.profiles.phone_number is
  'International E.164 phone number used for SMS task reminders and signing links.';

notify pgrst, 'reload schema';
