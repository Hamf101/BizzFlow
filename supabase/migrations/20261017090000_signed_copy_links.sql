-- Links to a completed document's signed copy, emailed to every signer and the
-- sender once the PDF is final. A signing link expires in days and is spent by
-- the next round; this one only downloads the finished paper, for 30 days.
-- Holds only a SHA-256 hash of the emailed token.
--
-- Closed like document_guest_grants: no signed-in or anonymous privileges,
-- reached only through the service layer.

create table public.document_signed_copy_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null,
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '30 days',
  created_at timestamptz not null default now(),
  constraint document_signed_copy_links_document_org_fkey
    foreign key (document_id, org_id) references public.documents (id, org_id) on delete cascade,
  constraint document_signed_copy_links_email_normalized
    check (email = lower(btrim(email)) and char_length(email) between 3 and 320),
  constraint document_signed_copy_links_token_hash_format
    check (token_hash ~ '^[0-9a-f]{64}$')
);

create index document_signed_copy_links_org_document_idx
  on public.document_signed_copy_links (org_id, document_id);

alter table public.document_signed_copy_links enable row level security;
alter table public.document_signed_copy_links force row level security;

revoke all on table public.document_signed_copy_links
  from public, anon, authenticated, service_role;
grant select, insert, delete on table public.document_signed_copy_links
  to service_role;
