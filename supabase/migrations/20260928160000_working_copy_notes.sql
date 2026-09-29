-- What people leave beside a working copy while they edit it together:
-- checkpoints to come back to, comments on its blocks, and a chat among
-- everyone editing it. Each belongs to the room and goes with it. As with the
-- room, signed-in users hold no privilege here; the app checks that the
-- person may edit what the room holds before reading or writing any of it.

-- A checkpoint keeps the working copy exactly as it stood and is never
-- changed. A restore first keeps the copy it replaces, pointing at the
-- checkpoint it brought back, so going back can itself be undone.
create table public.working_copy_checkpoints (
  id uuid primary key,
  org_id uuid not null,
  room_id uuid not null,
  revision bigint not null check (revision >= 0),
  label text not null check (label = btrim(label) and char_length(label) between 1 and 120),
  value jsonb not null check (jsonb_typeof(value) = 'object' and octet_length(value::text) <= 16777216),
  value_hash text not null check (value_hash ~ '^[0-9a-f]{64}$'),
  schema_version smallint not null check (schema_version > 0),
  restored_from uuid,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (room_id, org_id)
    references public.working_copy_rooms (id, org_id) on delete cascade,
  foreign key (restored_from, org_id)
    references public.working_copy_checkpoints (id, org_id) on delete set null (restored_from)
);

create index working_copy_checkpoints_room_idx on public.working_copy_checkpoints (room_id, created_at desc);
create index working_copy_checkpoints_org_idx on public.working_copy_checkpoints (org_id);
create index working_copy_checkpoints_restored_idx on public.working_copy_checkpoints (restored_from, org_id)
  where restored_from is not null;
create index working_copy_checkpoints_creator_idx on public.working_copy_checkpoints (created_by)
  where created_by is not null;

-- A thread starts with a comment on a block, or on the page, and its replies
-- point at that first comment. Only a thread is resolved, on its first comment.
create table public.working_copy_comments (
  id uuid primary key,
  org_id uuid not null,
  room_id uuid not null,
  thread_id uuid not null,
  block_id uuid,
  quote text check (quote is null or char_length(quote) between 1 and 500),
  body text not null check (body = btrim(body) and char_length(body) between 1 and 4000),
  author_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  unique (id, org_id),
  foreign key (room_id, org_id)
    references public.working_copy_rooms (id, org_id) on delete cascade,
  foreign key (thread_id, org_id)
    references public.working_copy_comments (id, org_id) on delete cascade,
  check (thread_id = id or (block_id is null and quote is null and resolved_at is null)),
  check ((resolved_at is null) = (resolved_by is null))
);

create index working_copy_comments_room_idx on public.working_copy_comments (room_id, created_at);
create index working_copy_comments_org_idx on public.working_copy_comments (org_id);
create index working_copy_comments_thread_idx on public.working_copy_comments (thread_id, org_id);
create index working_copy_comments_author_idx on public.working_copy_comments (author_id)
  where author_id is not null;
create index working_copy_comments_resolver_idx on public.working_copy_comments (resolved_by)
  where resolved_by is not null;

-- The chat among everyone editing one working copy.
create table public.working_copy_messages (
  id uuid primary key,
  org_id uuid not null,
  room_id uuid not null,
  body text not null check (body = btrim(body) and char_length(body) between 1 and 4000),
  author_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (room_id, org_id)
    references public.working_copy_rooms (id, org_id) on delete cascade
);

create index working_copy_messages_room_idx on public.working_copy_messages (room_id, created_at);
create index working_copy_messages_org_idx on public.working_copy_messages (org_id);
create index working_copy_messages_author_idx on public.working_copy_messages (author_id)
  where author_id is not null;

alter table public.working_copy_checkpoints enable row level security;
alter table public.working_copy_checkpoints force row level security;
alter table public.working_copy_comments enable row level security;
alter table public.working_copy_comments force row level security;
alter table public.working_copy_messages enable row level security;
alter table public.working_copy_messages force row level security;

revoke all on table public.working_copy_checkpoints from anon, authenticated, service_role;
revoke all on table public.working_copy_comments from anon, authenticated, service_role;
revoke all on table public.working_copy_messages from anon, authenticated, service_role;
-- Checkpoints and messages are never changed; a comment's thread is resolved or reopened.
grant select, insert on table public.working_copy_checkpoints to service_role;
grant select, insert, update (resolved_at, resolved_by) on table public.working_copy_comments to service_role;
grant select, insert on table public.working_copy_messages to service_role;
