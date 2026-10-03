-- Exercises invites and owners against a real database: an invite is kept only
-- as its token's hash and accepted with the token itself, never with the hash;
-- accepting never lowers an owner; and an owner's membership cannot be demoted,
-- disabled or removed while the workspace exists, though deleting the workspace
-- still takes it. Creates isolated synthetic rows inside one statement; any
-- failed check rolls everything back.
do $$
declare
  owner_id uuid := gen_random_uuid();
  invitee_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  invite_id uuid := gen_random_uuid();
  owner_invite_id uuid := gen_random_uuid();
  token constant text := 'live-rpc-invite-token-0123456789abcdef';
  owner_token constant text := 'live-rpc-owner-token-0123456789abcdef';
  owner_email text := 'inv-' || replace(owner_id::text, '-', '') || '@example.invalid';
  invitee_email text := 'inv-' || replace(invitee_id::text, '-', '') || '@example.invalid';
  membership_id uuid;
begin
  insert into auth.users (id, email, created_at, updated_at)
  values (owner_id, owner_email, now(), now()), (invitee_id, invitee_email, now(), now());

  insert into public.profiles (id, email)
  values (owner_id, owner_email), (invitee_id, invitee_email);

  insert into public.organizations (id, name, slug, created_by)
  values (organization_id, 'Invite verification', 'inv-' || replace(organization_id::text, '-', ''), owner_id);

  insert into public.organization_memberships (org_id, user_id, role, status)
  select organization_id, owner_id, 'owner_admin', 'active'
  where not exists (
    select 1 from public.organization_memberships membership
    where membership.org_id = organization_id and membership.user_id = owner_id
  );

  -- A plaintext token is refused outright.
  begin
    insert into public.invites (id, org_id, email, role, token, token_hash, invited_by)
    values (gen_random_uuid(), organization_id, invitee_email, 'staff', token,
            encode(sha256(convert_to(token, 'UTF8')), 'hex'), owner_id);
    raise exception 'An invite kept its plaintext token.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;

  insert into public.invites (id, org_id, email, role, token_hash, invited_by)
  values
    (invite_id, organization_id, invitee_email, 'staff', encode(sha256(convert_to(token, 'UTF8')), 'hex'), owner_id),
    (owner_invite_id, organization_id, owner_email, 'staff', encode(sha256(convert_to(owner_token, 'UTF8')), 'hex'), owner_id);

  set local role service_role;

  -- The stored hash is not a way in; the token is.
  begin
    perform public.accept_organization_invite(invite_id, encode(sha256(convert_to(token, 'UTF8')), 'hex'), invitee_id, invitee_email);
    raise exception 'The stored hash accepted an invite.' using errcode = 'XX001';
  exception when sqlstate 'P0002' then null;
  end;

  membership_id := public.accept_organization_invite(invite_id, token, invitee_id, invitee_email);
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.id = membership_id and membership.role = 'staff' and membership.status = 'active'
  ) then
    raise exception 'Accepting with the token did not make a staff member.';
  end if;

  -- An owner accepting an invite to their own workspace stays an owner.
  begin
    perform public.accept_organization_invite(owner_invite_id, owner_token, owner_id, owner_email);
    raise exception 'An invite lowered an owner.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;

  -- An owner's membership is permanent while the workspace exists.
  begin
    update public.organization_memberships set role = 'manager'
    where org_id = organization_id and user_id = owner_id;
    raise exception 'An owner was demoted.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;

  begin
    update public.organization_memberships set status = 'disabled'
    where org_id = organization_id and user_id = owner_id;
    raise exception 'An owner was disabled.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;

  reset role;

  begin
    delete from public.organization_memberships where org_id = organization_id and user_id = owner_id;
    raise exception 'An owner was removed.' using errcode = 'XX001';
  exception when sqlstate '23514' then null;
  end;

  -- Their other settings still change.
  update public.organization_memberships set workspace_display_name = 'Boss'
  where org_id = organization_id and user_id = owner_id;

  -- Deleting the workspace takes the owner's membership with it.
  delete from public.organizations where id = organization_id;
  if exists (select 1 from public.organization_memberships where org_id = organization_id) then
    raise exception 'Memberships outlived their workspace.';
  end if;

  delete from auth.users where id in (owner_id, invitee_id);
end;
$$;
