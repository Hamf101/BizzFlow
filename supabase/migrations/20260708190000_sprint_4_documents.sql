create table public.folders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  parent_folder_id uuid,
  name text not null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  archived_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  constraint folders_name_length check (char_length(name) between 1 and 120),
  constraint folders_no_self_parent check (parent_folder_id is null or parent_folder_id <> id),
  constraint folders_parent_folder_id_org_id_fkey
    foreign key (parent_folder_id, org_id) references public.folders (id, org_id) on delete set null (parent_folder_id)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  folder_id uuid,
  title text not null,
  description text,
  current_version_id uuid,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  archived_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  constraint documents_folder_id_org_id_fkey
    foreign key (folder_id, org_id) references public.folders (id, org_id) on delete set null (folder_id),
  constraint documents_title_length check (char_length(title) between 1 and 180)
);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null,
  version_number integer not null,
  status text not null default 'upload_pending',
  storage_key text not null,
  original_filename text not null,
  content_type text not null,
  byte_size bigint not null,
  checksum_sha256 text,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, document_id),
  unique (document_id, version_number),
  unique (storage_key),
  constraint document_versions_document_id_org_id_fkey
    foreign key (document_id, org_id) references public.documents (id, org_id) on delete cascade,
  constraint document_versions_version_number_positive check (version_number > 0),
  constraint document_versions_byte_size_positive check (byte_size > 0),
  constraint document_versions_original_filename_length check (char_length(original_filename) between 1 and 255),
  constraint document_versions_status_check check (status in ('upload_pending', 'available'))
);

alter table public.documents
  add constraint documents_current_version_id_document_id_fkey
  foreign key (current_version_id, id) references public.document_versions (id, document_id) deferrable initially deferred;

create index folders_org_parent_name_idx
  on public.folders (org_id, parent_folder_id, lower(name));

create unique index folders_root_name_unique_idx
  on public.folders (org_id, lower(name))
  where parent_folder_id is null;

create unique index folders_child_name_unique_idx
  on public.folders (org_id, parent_folder_id, lower(name))
  where parent_folder_id is not null;

create index documents_org_folder_active_idx
  on public.documents (org_id, folder_id, created_at desc)
  where archived_at is null;

create index documents_org_archived_idx
  on public.documents (org_id, archived_at desc)
  where archived_at is not null;

create index documents_created_by_idx
  on public.documents (created_by);

create index document_versions_document_created_idx
  on public.document_versions (document_id, created_at desc);

create index document_versions_org_created_idx
  on public.document_versions (org_id, created_at desc);

create trigger folders_set_updated_at
  before update on public.folders
  for each row execute function public.set_updated_at();

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

create trigger document_versions_set_updated_at
  before update on public.document_versions
  for each row execute function public.set_updated_at();

alter table public.folders enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;

alter table public.folders force row level security;
alter table public.documents force row level security;
alter table public.document_versions force row level security;

grant usage on schema public to authenticated, service_role;

grant select on table public.folders to authenticated;
grant select on table public.documents to authenticated;
grant select on table public.document_versions to authenticated;

grant select, insert, update, delete on table public.folders to service_role;
grant select, insert, update, delete on table public.documents to service_role;
grant select, insert, update, delete on table public.document_versions to service_role;

revoke insert, update, delete on table public.folders from authenticated;
revoke insert, update, delete on table public.documents from authenticated;
revoke insert, update, delete on table public.document_versions from authenticated;

create policy folders_select_member
  on public.folders
  for select
  to authenticated
  using ((select public.is_organization_member(org_id)));

create policy documents_select_member
  on public.documents
  for select
  to authenticated
  using ((select public.is_organization_member(org_id)));

create policy document_versions_select_member
  on public.document_versions
  for select
  to authenticated
  using ((select public.is_organization_member(org_id)));

notify pgrst, 'reload schema';
