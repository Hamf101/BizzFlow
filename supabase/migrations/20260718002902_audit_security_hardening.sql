drop policy if exists profiles_insert_self on public.profiles;
drop policy if exists profiles_update_self on public.profiles;

revoke insert, update, delete on table public.profiles from authenticated;

revoke all privileges on table public.profiles from anon;
revoke all privileges on table public.organizations from anon;
revoke all privileges on table public.organization_memberships from anon;
revoke all privileges on table public.invites from anon;
revoke all privileges on table public.audit_logs from anon;
revoke all privileges on table public.folders from anon;
revoke all privileges on table public.documents from anon;
revoke all privileges on table public.document_versions from anon;

drop policy if exists document_templates_select_published_member
  on public.document_templates;

create policy document_templates_select_published_member
  on public.document_templates
  for select
  to authenticated
  using (
    status = 'published'
    and (select public.organization_role_for(org_id)) in (
      'owner_admin',
      'manager',
      'staff'
    )
  );

revoke select on table public.document_signing_recipients from authenticated;

grant select (
  id,
  org_id,
  document_id,
  user_id,
  name,
  email,
  requires_signature,
  status,
  token_expires_at,
  invited_at,
  viewed_at,
  signed_at
) on table public.document_signing_recipients to authenticated;

drop index if exists public.organization_memberships_org_user_idx;

drop index if exists public.profiles_email_unique_idx;

create unique index profiles_email_unique_idx
  on public.profiles (email)
  where email is not null;

create index organization_memberships_user_active_created_idx
  on public.organization_memberships (user_id, created_at, id)
  where status = 'active';

create index invites_org_pending_created_idx
  on public.invites (org_id, created_at desc, id)
  where status = 'pending';

create index documents_org_active_created_idx
  on public.documents (org_id, created_at desc, id)
  where archived_at is null;

create or replace function public.accept_organization_invite(
  target_invite_id uuid,
  target_token text,
  target_user_id uuid,
  target_user_email text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_invite_org_id uuid;
  locked_invite_email text;
  locked_invite_role public.organization_role;
  locked_invite_status public.invite_status;
  locked_invite_expires_at timestamptz;
  normalized_user_email text;
  accepted_membership_id uuid;
begin
  normalized_user_email := lower(btrim(target_user_email));

  if normalized_user_email is null
      or char_length(normalized_user_email) < 3
      or char_length(normalized_user_email) > 320
      or position('@' in normalized_user_email) <= 1 then
    raise exception 'Invite email is invalid.'
      using errcode = '22023';
  end if;

  select
    invite.org_id,
    invite.email,
    invite.role,
    invite.status,
    invite.expires_at
  into
    locked_invite_org_id,
    locked_invite_email,
    locked_invite_role,
    locked_invite_status,
    locked_invite_expires_at
  from public.invites invite
  where invite.id = target_invite_id
    and invite.token = target_token
  for update;

  if not found
      or locked_invite_status <> 'pending'
      or locked_invite_expires_at <= now()
      or locked_invite_email <> normalized_user_email then
    raise exception 'Invite is invalid or expired.'
      using errcode = 'P0002';
  end if;

  insert into public.profiles (id, email)
  values (target_user_id, normalized_user_email)
  on conflict (id)
  do update set email = excluded.email;

  insert into public.organization_memberships (
    org_id,
    user_id,
    role,
    status
  )
  values (
    locked_invite_org_id,
    target_user_id,
    locked_invite_role,
    'active'
  )
  on conflict (org_id, user_id)
  do update
  set role = excluded.role,
      status = 'active'
  returning id into accepted_membership_id;

  update public.invites invite
  set status = 'accepted',
      accepted_by = target_user_id,
      accepted_at = now()
  where invite.id = target_invite_id;

  return accepted_membership_id;
end;
$$;

create or replace function public.update_organization_member_role(
  target_org_id uuid,
  target_membership_id uuid,
  target_actor_user_id uuid,
  target_role public.organization_role
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_role public.organization_role;
  existing_role public.organization_role;
  existing_status public.membership_status;
  active_owner_count bigint;
  updated_membership_id uuid;
begin
  if target_role is null or target_role = 'owner_admin' then
    raise exception 'That role cannot be assigned.'
      using errcode = '22023';
  end if;

  perform 1
  from public.organizations organization
  where organization.id = target_org_id
  for update;

  if not found then
    raise exception 'Organization was not found.'
      using errcode = 'P0002';
  end if;

  select membership.role
  into actor_role
  from public.organization_memberships membership
  where membership.org_id = target_org_id
    and membership.user_id = target_actor_user_id
    and membership.status = 'active';

  if not found or actor_role <> 'owner_admin' then
    raise exception 'Actor cannot update member roles.'
      using errcode = '42501';
  end if;

  select membership.role, membership.status
  into existing_role, existing_status
  from public.organization_memberships membership
  where membership.id = target_membership_id
    and membership.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Member was not found.'
      using errcode = 'P0002';
  end if;

  if existing_role = 'owner_admin' and existing_status = 'active' then
    select count(*)
    into active_owner_count
    from public.organization_memberships membership
    where membership.org_id = target_org_id
      and membership.role = 'owner_admin'
      and membership.status = 'active';

    if active_owner_count <= 1 then
      raise exception 'The organization must keep one owner.'
        using errcode = '23514';
    end if;
  end if;

  update public.organization_memberships membership
  set role = target_role
  where membership.id = target_membership_id
    and membership.org_id = target_org_id
  returning membership.id into updated_membership_id;

  return updated_membership_id;
end;
$$;

create or replace function public.merge_generated_document_answers(
  target_org_id uuid,
  target_document_id uuid,
  target_values jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing_values jsonb;
  existing_workflow_status text;
begin
  if target_values is null or jsonb_typeof(target_values) <> 'object' then
    raise exception 'Document answer values must be a JSON object.'
      using errcode = '22023';
  end if;

  select answer.values, answer.workflow_status
  into existing_values, existing_workflow_status
  from public.document_answers answer
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id
  for update;

  if not found then
    raise exception 'Generated document answers were not found.'
      using errcode = 'P0002';
  end if;

  if existing_workflow_status = 'completed' then
    raise exception 'Completed document answers are immutable.'
      using errcode = '23514';
  end if;

  update public.document_answers answer
  set values = existing_values || target_values
  where answer.document_id = target_document_id
    and answer.org_id = target_org_id
  returning answer.values into existing_values;

  return existing_values;
end;
$$;

revoke execute on function public.accept_organization_invite(
  uuid,
  text,
  uuid,
  text
) from public, anon, authenticated;

revoke execute on function public.update_organization_member_role(
  uuid,
  uuid,
  uuid,
  public.organization_role
) from public, anon, authenticated;

revoke execute on function public.merge_generated_document_answers(
  uuid,
  uuid,
  jsonb
) from public, anon, authenticated;

grant execute on function public.accept_organization_invite(
  uuid,
  text,
  uuid,
  text
) to service_role;

grant execute on function public.update_organization_member_role(
  uuid,
  uuid,
  uuid,
  public.organization_role
) to service_role;

grant execute on function public.merge_generated_document_answers(
  uuid,
  uuid,
  jsonb
) to service_role;

notify pgrst, 'reload schema';
