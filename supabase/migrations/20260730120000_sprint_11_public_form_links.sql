create table public.public_form_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  template_id uuid not null,
  token text not null unique,
  status text not null default 'active',
  expires_at timestamptz,
  max_submissions integer,
  submission_count integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  constraint public_form_links_template_fkey
    foreign key (template_id, org_id)
    references public.document_templates (id, org_id)
    on delete cascade,
  constraint public_form_links_token_length
    check (token = btrim(token) and char_length(token) between 10 and 100),
  constraint public_form_links_status_check
    check (status in ('active', 'expired', 'disabled')),
  constraint public_form_links_max_submissions_check
    check (max_submissions is null or max_submissions > 0),
  constraint public_form_links_submission_count_check
    check (submission_count >= 0)
);

create index public_form_links_org_template_idx
  on public.public_form_links (org_id, template_id);

create index public_form_links_token_idx
  on public.public_form_links (token);

create index public_form_links_active_token_idx
  on public.public_form_links (token)
  where status = 'active';

alter table public.public_form_links enable row level security;

create policy public_form_links_owner_admin_all
  on public.public_form_links
  for all
  using (
    exists (
      select 1
      from public.organization_memberships m
      where m.org_id = public_form_links.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner_admin', 'manager')
    )
  )
  with check (
    exists (
      select 1
      from public.organization_memberships m
      where m.org_id = public_form_links.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner_admin', 'manager')
    )
  );

-- Deliberately NO anon/authenticated SELECT policy: a permissive policy without an
-- org_id predicate is OR-combined with the owner/manager policy above and would expose
-- every tenant's link tokens. Public reads go exclusively through the service-role
-- client in public-form-service.ts, which resolves a single link by token.
revoke all on table public.public_form_links from anon;
grant select, insert, update, delete on table public.public_form_links to authenticated;

create or replace function public.increment_public_form_link_submission_count(
  p_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link_id uuid;
begin
  update public.public_form_links
  set submission_count = submission_count + 1,
      updated_at = now()
  where token = p_token
    and status = 'active'
    and (expires_at is null or expires_at > now())
    and (max_submissions is null or submission_count < max_submissions)
  returning id into v_link_id;

  return v_link_id is not null;
end;
$$;

-- Only the service-role client calls this. Granting it to anon would let anyone who
-- learns a token exhaust the link's submission budget without ever submitting a form.
revoke all on function public.increment_public_form_link_submission_count(text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public submission drafts
--
-- A public file upload must be parented by a real submission: submission_files
-- requires a non-null submission_id AND submission_files_storage_key_check ties
-- the object key to that exact submission id. So the first upload for a public
-- form allocates a draft submission, and submit transitions draft -> submitted.
--
-- public_draft_token is the unguessable server-issued handle the anonymous
-- browser holds. It is never the submission UUID, so it cannot be used to
-- enumerate or attach to another visitor's draft, and it is cleared on submit
-- so it cannot be replayed.
-- ---------------------------------------------------------------------------

alter table public.submissions
  add column public_form_link_id uuid,
  add column public_draft_token text;

alter table public.submissions
  add constraint submissions_public_form_link_fkey
    foreign key (public_form_link_id, org_id)
    references public.public_form_links (id, org_id)
    on delete set null,
  add constraint submissions_public_draft_token_format
    check (
      public_draft_token is null
      or (
        public_form_link_id is not null
        and public_draft_token ~ '^[0-9a-f]{64}$'
      )
    );

create unique index submissions_public_draft_token_idx
  on public.submissions (public_draft_token)
  where public_draft_token is not null;

create index submissions_public_form_link_idx
  on public.submissions (public_form_link_id)
  where public_form_link_id is not null;

comment on column public.submissions.public_form_link_id is
  'Set when the submission originated from a public form link rather than a member.';
comment on column public.submissions.public_draft_token is
  'Unguessable handle held by an anonymous submitter while their draft collects files. Cleared on submit.';

-- ---------------------------------------------------------------------------
-- Allow an actor-less public submission to transition draft -> submitted.
--
-- Every other guard from 20260718190946 is carried forward unchanged; only the
-- three marked rules differ. public_form_link_id is immutable, and the draft
-- handle may be cleared but never reassigned.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_submission_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_by_cleanup boolean;
  updated_by_cleanup boolean;
  submitted_by_cleanup boolean;
  assigned_to_cleanup boolean;
  assigned_by_cleanup boolean;
  substantive_change boolean;
begin
  created_by_cleanup :=
    new.created_by is not distinct from old.created_by
    or (old.created_by is not null and new.created_by is null);
  updated_by_cleanup :=
    new.updated_by is not distinct from old.updated_by
    or (old.updated_by is not null and new.updated_by is null);
  submitted_by_cleanup :=
    new.submitted_by is not distinct from old.submitted_by
    or (old.submitted_by is not null and new.submitted_by is null);
  assigned_to_cleanup :=
    new.assigned_to is not distinct from old.assigned_to
    or (old.assigned_to is not null and new.assigned_to is null);
  assigned_by_cleanup :=
    new.assigned_by is not distinct from old.assigned_by
    or (old.assigned_by is not null and new.assigned_by is null);

  if new.id is distinct from old.id
      or new.org_id is distinct from old.org_id
      or new.title is distinct from old.title
      or new.template_id is distinct from old.template_id
      or new.template_revision is distinct from old.template_revision
      or new.template_snapshot is distinct from old.template_snapshot
      or new.public_form_link_id is distinct from old.public_form_link_id
      or not created_by_cleanup
      or new.created_at is distinct from old.created_at then
    raise exception 'Template snapshot identity is immutable.'
      using errcode = '23514';
  end if;

  if new.status is distinct from old.status
      and not (
        (old.status = 'draft' and new.status = 'submitted')
        or (old.status = 'submitted' and new.status = 'in_review')
        or (
          old.status = 'in_review'
          and new.status in ('needs_changes', 'approved', 'rejected')
        )
        or (old.status = 'needs_changes' and new.status = 'submitted')
        or (old.status = 'approved' and new.status = 'completed')
      ) then
    raise exception 'Submission status transition is invalid.'
      using errcode = '23514';
  end if;

  if new.values is distinct from old.values
      and not (
        old.status in ('draft', 'needs_changes')
        and new.status in (old.status, 'submitted')
      ) then
    raise exception 'Submission values cannot change in this status.'
      using errcode = '23514';
  end if;

  if new.submitted_at is distinct from old.submitted_at
      and not (
        old.status in ('draft', 'needs_changes')
        and new.status = 'submitted'
        and new.submitted_at is not null
      ) then
    raise exception 'Submission timestamp transition is invalid.'
      using errcode = '23514';
  end if;

  if old.status in ('draft', 'needs_changes')
      and new.status = 'submitted'
      and new.submitted_by is null
      and new.public_form_link_id is null then
    raise exception 'Submission actor is required when submitting.'
      using errcode = '23514';
  end if;

  if not submitted_by_cleanup
      and not (
        old.status in ('draft', 'needs_changes')
        and new.status = 'submitted'
        and new.submitted_by is not null
      ) then
    raise exception 'Submission actor cannot change outside submission.'
      using errcode = '23514';
  end if;

  if (
      not assigned_to_cleanup
      or not assigned_by_cleanup
      or new.assigned_at is distinct from old.assigned_at
    )
    and not (
      old.status = 'submitted' and new.status = 'in_review'
      or old.status = 'in_review' and new.status = 'in_review'
      or old.status = 'needs_changes' and new.status = 'needs_changes'
    ) then
    raise exception 'Submission assignment cannot change in this status.'
      using errcode = '23514';
  end if;

  if (
      not assigned_to_cleanup
      or not assigned_by_cleanup
      or new.assigned_at is distinct from old.assigned_at
    )
    and (
      new.assigned_to is null
      or new.assigned_by is null
      or new.assigned_at is null
    ) then
    raise exception 'Submission assignment requires complete actor metadata.'
      using errcode = '23514';
  end if;

  if new.public_draft_token is distinct from old.public_draft_token
      and new.public_draft_token is not null then
    raise exception 'Public draft token cannot be reassigned.'
      using errcode = '23514';
  end if;

  substantive_change :=
    new.values is distinct from old.values
    or new.status is distinct from old.status
    or new.updated_at is distinct from old.updated_at
    or new.submitted_at is distinct from old.submitted_at
    or new.assigned_at is distinct from old.assigned_at
    or not updated_by_cleanup
    or not submitted_by_cleanup
    or not assigned_to_cleanup
    or not assigned_by_cleanup;

  if substantive_change and new.revision <> old.revision + 1 then
    raise exception 'Submission revision must advance exactly once.'
      using errcode = '23514';
  end if;

  if not substantive_change and new.revision <> old.revision then
    raise exception 'Submission revision cannot change without content.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_submission_update()
  from public, anon, authenticated, service_role;

comment on table public.public_form_links is
  'Shareable public links for submitting published form templates anonymously.';

notify pgrst, 'reload schema';
