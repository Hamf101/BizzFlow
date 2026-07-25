create table public.template_flow_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  template_id uuid not null,
  author_user_id uuid references public.profiles (id) on delete set null,
  author_name text,
  role text not null,
  content text not null,
  change_set jsonb,
  created_at timestamptz not null default now(),
  constraint template_flow_messages_template_org_fkey
    foreign key (template_id, org_id)
    references public.document_templates (id, org_id)
    on delete cascade,
  constraint template_flow_messages_role_check
    check (role in ('user', 'assistant')),
  constraint template_flow_messages_author_shape
    check (
      (role = 'user' and author_name is not null)
      or (
        role = 'assistant'
        and author_user_id is null
        and author_name is null
      )
    ),
  constraint template_flow_messages_author_name_length
    check (
      author_name is null
      or (
        author_name = btrim(author_name)
        and char_length(author_name) between 1 and 160
      )
    ),
  constraint template_flow_messages_content_length
    check (
      content = btrim(content)
      and char_length(content) between 1 and 2000
    ),
  constraint template_flow_messages_change_set_object
    check (change_set is null or jsonb_typeof(change_set) = 'object')
);

create index template_flow_messages_template_created_idx
  on public.template_flow_messages (template_id, created_at, id);

create index template_flow_messages_org_template_idx
  on public.template_flow_messages (org_id, template_id);

create index template_flow_messages_author_idx
  on public.template_flow_messages (author_user_id)
  where author_user_id is not null;

alter table public.template_flow_messages enable row level security;
alter table public.template_flow_messages force row level security;

create policy template_flow_messages_select_manager
  on public.template_flow_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_memberships membership
      where membership.org_id = template_flow_messages.org_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and membership.role in ('owner_admin', 'manager')
    )
  );

revoke all on table public.template_flow_messages from anon;
revoke insert, update, delete on table public.template_flow_messages
  from authenticated;
grant select on table public.template_flow_messages to authenticated;
grant select, insert, update, delete
  on table public.template_flow_messages
  to service_role;

comment on table public.template_flow_messages is
  'Shared template-scoped Flow chat with optional validated change receipts.';

notify pgrst, 'reload schema';
