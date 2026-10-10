-- People outside a workspace who were given one document.
--
-- A guest is invited by email and is never a member: their access is this row
-- alone, to this one document, and deleting the row takes it away. Until they
-- accept, the row holds only a SHA-256 hash of the emailed token; accepting
-- (signed in as the invited address) ties it to their account and clears the
-- hash, so the link works once. Levels are the document levels: viewer or
-- contributor ("Editor").
--
-- Closed like document_access_grants: no signed-in or anonymous privileges,
-- reached only through the service layer.

create table public.document_guest_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null,
  email text not null,
  user_id uuid references public.profiles (id) on delete cascade,
  access_level public.resource_access_level not null,
  invite_token_hash text unique,
  invite_expires_at timestamptz,
  invited_by uuid,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, document_id, email),
  constraint document_guest_grants_document_org_fkey
    foreign key (document_id, org_id)
    references public.documents (id, org_id)
    on delete cascade,
  constraint document_guest_grants_invited_by_membership_fkey
    foreign key (org_id, invited_by)
    references public.organization_memberships (org_id, user_id)
    on delete set null (invited_by),
  constraint document_guest_grants_email_normalized
    check (email = lower(btrim(email)) and char_length(email) between 3 and 320 and position('@' in email) > 1),
  constraint document_guest_grants_token_hash_format
    check (invite_token_hash is null or invite_token_hash ~ '^[0-9a-f]{64}$'),
  -- Waiting for them: a live token and its expiry. Joined: their account, and no token.
  constraint document_guest_grants_invited_or_joined
    check (
      (accepted_at is null and user_id is null and invite_token_hash is not null and invite_expires_at is not null)
      or (accepted_at is not null and user_id is not null and invite_token_hash is null)
    )
);

create index document_guest_grants_org_document_idx
  on public.document_guest_grants (org_id, document_id);

create index document_guest_grants_user_idx
  on public.document_guest_grants (user_id)
  where user_id is not null;

create index document_guest_grants_invited_by_fk_idx
  on public.document_guest_grants (org_id, invited_by)
  where invited_by is not null;

create trigger document_guest_grants_set_updated_at
  before update on public.document_guest_grants
  for each row execute function public.set_updated_at();

alter table public.document_guest_grants enable row level security;
alter table public.document_guest_grants force row level security;

revoke all on table public.document_guest_grants
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.document_guest_grants
  to service_role;
