-- Reads the security posture from the migrated database's own catalog, so it
-- sees every overload, schema and grant exactly as Postgres applies them:
-- every table in public and private has row-level security enabled and forced;
-- no function there is executable by public, anon or authenticated, save
-- trigger functions and the policy helpers allowed below; every security
-- definer function pins its search_path; signed-in and anonymous callers hold
-- no privilege on any relation there, nor by default on future ones; and
-- realtime.messages carries only the intended policies. Reads only; lists every
-- violation at once.
do $$
declare
  anon_oid constant oid := 'anon'::regrole;
  authenticated_oid constant oid := 'authenticated'::regrole;
  violations text[];
begin
  select coalesce(array_agg(format('%s.%s has row-level security %s', n.nspname, c.relname,
    case when c.relrowsecurity then 'enabled but not forced' else 'disabled' end) order by 1), '{}')
  into violations
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private')
    and c.relkind in ('r', 'p')
    and not (c.relrowsecurity and c.relforcerowsecurity);

  -- Postgres makes a new function executable by public, and Supabase's default
  -- privileges add anon and authenticated, so each must be revoked. A trigger
  -- function cannot be called on its own. The allow-list is matched by full
  -- signature, so a new overload of an allowed name is still caught.
  violations := violations || coalesce((
    select array_agg(format('%s is executable by %s', p.oid::regprocedure, callers) order by 1)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral (
      select string_agg(case a.grantee when 0 then 'public' else a.grantee::regrole::text end, ', ') callers
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.privilege_type = 'EXECUTE'
        and a.grantee in (0, anon_oid, authenticated_oid)
    ) granted
    where n.nspname in ('public', 'private')
      and granted.callers is not null
      and p.prorettype <> 'trigger'::regtype
      and p.oid not in (
        -- Predicates of the dormant row-level policies on folders, documents
        -- and their children (folders_select_acl, documents_select_acl, ...).
        -- A policy runs with the querying role's privileges, so it needs
        -- execute; each answers only for auth.uid(), and private is not an
        -- exposed API schema.
        'private.authenticated_can_access_folder(uuid, uuid)'::regprocedure,
        'private.authenticated_can_access_document(uuid, uuid)'::regprocedure,
        -- Predicate of the realtime.messages policies checked below: Realtime
        -- evaluates them as the signed-in member joining a room's channel.
        'private.can_join_working_copy(text)'::regprocedure
      )
  ), '{}');

  -- Without a pinned search_path, a definer function resolves names through
  -- the caller's path, which the caller controls.
  violations := violations || coalesce((
    select array_agg(format('%s is security definer without a search_path', p.oid::regprocedure) order by 1)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and not exists (
        select 1 from unnest(p.proconfig) setting where setting like 'search_path=%'
      )
  ), '{}');

  -- Any relation: tables, views, sequences. Signed-in users reach tenant data
  -- only through the services.
  violations := violations || coalesce((
    select array_agg(distinct format('%s.%s grants %s to %s', n.nspname, c.relname, a.privilege_type,
      case a.grantee when 0 then 'public' else a.grantee::regrole::text end))
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
    where n.nspname in ('public', 'private')
      and a.grantee in (0, anon_oid, authenticated_oid)
  ), '{}');

  violations := violations || coalesce((
    select array_agg(distinct format('%s.%s.%s grants %s to %s', n.nspname, c.relname, att.attname, a.privilege_type,
      case a.grantee when 0 then 'public' else a.grantee::regrole::text end))
    from pg_attribute att
    join pg_class c on c.oid = att.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(att.attacl) a
    where n.nspname in ('public', 'private')
      and a.grantee in (0, anon_oid, authenticated_oid)
  ), '{}');

  -- Migrations run as postgres, so its default privileges decide what a new
  -- table, sequence or function starts with.
  violations := violations || coalesce((
    select array_agg(distinct format('postgres''s default privileges in %s grant %s on new %s to %s',
      d.defaclnamespace::regnamespace, a.privilege_type,
      case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' else d.defaclobjtype::text end,
      case a.grantee when 0 then 'public' else a.grantee::regrole::text end))
    from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole
      and d.defaclnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and a.grantee in (0, anon_oid, authenticated_oid)
  ), '{}');

  -- Realtime: a member hears only their own notices and the rooms of working
  -- copies they may edit, and in a room may only send presence.
  if not (select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass) then
    violations := violations || 'realtime.messages has row-level security disabled'::text;
  end if;

  violations := violations || coalesce((
    select array_agg(format('realtime.messages policy %L (%s to %s) is not intended', p.policyname, p.cmd, p.roles) order by 1)
    from pg_policies p
    where p.schemaname = 'realtime'
      and p.tablename = 'messages'
      and not exists (
        select 1
        from (values
          ('Editors of a working copy hear its room', 'SELECT', array['private.can_join_working_copy(']),
          ('Editors of a working copy say where they are', 'INSERT', array['private.can_join_working_copy(', 'extension = ''presence''']),
          ('Members hear their own notices', 'SELECT', array['''user:''::text || (( SELECT auth.uid()'])
        ) as intended(name, command, fragments)
        where intended.name = p.policyname
          and intended.command = p.cmd
          and p.permissive = 'PERMISSIVE'
          and p.roles = array['authenticated']::name[]
          and (
            select bool_and(position(fragment in coalesce(p.qual, p.with_check)) > 0)
            from unnest(intended.fragments) fragment
          )
      )
  ), '{}');

  -- Each intended policy is there once: three names, three policies.
  violations := violations || coalesce((
    select array[format('realtime.messages has %s policies, not the 3 intended', count(*))]
    from pg_policies
    where schemaname = 'realtime' and tablename = 'messages'
    having count(*) <> 3
  ), '{}');

  if cardinality(violations) > 0 then
    raise exception E'Catalog security posture violated:\n  %', array_to_string(violations, E'\n  ');
  end if;
end;
$$;
