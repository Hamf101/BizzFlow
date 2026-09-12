-- Close direct Data API table access for signed-in users.
--
-- Signed-in users reach tenant data only through the service layer, which
-- checks each member's current role-definition permissions on every request.
-- The authenticated role's remaining table privileges predate editable roles.
-- Their policies read legacy base roles, tenant membership, or document ACLs,
-- so narrowing a role did not narrow what that member could read (or, for
-- public form links, write) through the Data API. No application code uses
-- them, because the user-token client only performs auth calls, so they are
-- removed instead of re-encoding the permission matrix in SQL. RLS stays
-- enabled and forced on every table as a fail-closed backstop.
--
-- Revoking a table privilege also revokes the matching column privileges, which
-- covers the column-level SELECT held on document_signing_recipients.
revoke all privileges on table
  public.audit_logs,
  public.document_activity_events,
  public.document_answers,
  public.document_comments,
  public.document_recent_accesses,
  public.document_signing_recipients,
  public.document_templates,
  public.document_versions,
  public.documents,
  public.folders,
  public.generated_document_finalizations,
  public.invites,
  public.notification_deliveries,
  public.organization_memberships,
  public.organization_roles,
  public.organizations,
  public.profiles,
  public.public_form_links,
  public.resource_purge_jobs,
  public.resource_purge_receipts,
  public.resource_purge_tombstones,
  public.submission_activity_events,
  public.submission_comments,
  public.submission_files,
  public.submissions,
  public.task_reminders,
  public.tasks,
  public.template_flow_messages
from anon, authenticated;

-- Tables created later start closed as well. Grant a signed-in privilege only
-- together with policies that check current role-definition permissions.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

-- These helpers exist only for the policies above. With no direct table access
-- left they have no signed-in caller, and they answer membership questions.
revoke execute on function public.is_organization_member(uuid)
  from anon, authenticated;
revoke execute on function public.organization_role_for(uuid)
  from anon, authenticated;
revoke execute on function public.shares_organization_with_profile(uuid)
  from anon, authenticated;

notify pgrst, 'reload schema';
