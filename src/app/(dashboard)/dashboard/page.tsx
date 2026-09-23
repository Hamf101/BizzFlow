import type { ReactElement } from "react"

import { DashboardHome } from "@/components/dashboard/dashboard-home"
import {
  buildQueue,
  describeActivity,
  describeRecentFiles,
  selectDueThisWeek,
} from "@/components/dashboard/dashboard-view"
import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import {
  canPerformOrganizationAction,
  getOrganizationRoleFromSubject,
  type OrganizationPermissionAction,
} from "@/lib/permissions"
import { listAuditLogPage } from "@/services/audit-service"
import { listDocumentCards, listRecentDocuments } from "@/services/document-service"
import {
  getOnboardingProgress,
  listOrganizationPeople,
} from "@/services/organization-service"
import { countSubmissionsByStatus, listSubmissionPage } from "@/services/submission-service"
import { listTaskPage } from "@/services/task-service"
import {
  SAMPLE_SUBMISSION_COUNT,
  STARTER_TEMPLATES,
} from "@/services/templates/starter-templates"
import type { GeneratedDocumentWorkflowStatus } from "@/types/template"

import {
  createOrganizationAction,
  seedSampleSubmissionsAction,
  seedStarterTemplatesAction,
} from "./actions"

// ponytail: the queue ranks the first page of each source (20 submissions per
// kind, 50 open tasks, the 20 documents you generated most recently); page
// through them when an organization outgrows that.
const PAGE = 20

export default async function DashboardPage(): Promise<ReactElement> {
  const user = await loadAuthenticatedPageUser("/dashboard")
  const { context, errorMessage: contextErrorMessage } =
    await loadPageOrganizationContext({
      userId: user.id,
      failureEvent: "dashboard_context_load_failed",
    })
  const now = new Date()
  const today = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    weekday: "long",
  }).format(now)

  if (!context) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl leading-none font-medium tracking-[-0.02em]">Dashboard</h1>

        {contextErrorMessage && (
          <Alert variant="destructive">
            <AlertTitle>Supabase setup incomplete</AlertTitle>
            <AlertDescription>{contextErrorMessage}</AlertDescription>
          </Alert>
        )}

        {!contextErrorMessage && (
          <Card>
            <CardHeader>
              <CardTitle>Create organization</CardTitle>
              <CardDescription>
                Start the tenant workspace that will own forms, documents, tasks,
                and submissions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={createOrganizationAction} className="flex flex-col gap-5">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="name">Organization name</FieldLabel>
                    <Input
                      id="name"
                      name="name"
                      type="text"
                      minLength={2}
                      maxLength={120}
                      required
                    />
                    <FieldDescription>
                      Use the business name your staff will recognize.
                    </FieldDescription>
                  </Field>
                </FieldGroup>
                <Button type="submit">Create organization</Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  const organizationId = context.organization.id
  const actor = { actorUserId: user.id, organizationId }
  const can = (action: OrganizationPermissionAction): boolean =>
    canPerformOrganizationAction(context.membership, action)
  const role = getOrganizationRoleFromSubject(context.membership)
  const canReview = can("submissions:review")

  // Each block degrades to empty on its own, so one failing read never takes
  // the whole home page down. Each says whether it answered, so the page can
  // tell an outage from an empty day.
  async function orEmpty<T>(
    event: string,
    read: () => Promise<T>,
    fallback: T
  ): Promise<{ ok: boolean; value: T }> {
    try {
      return { ok: true, value: await read() }
    } catch (error: unknown) {
      console.warn(event, {
        organizationId,
        reason: getPageErrorMessage(error, "Unavailable."),
        userId: user.id,
      })
      return { ok: false, value: fallback }
    }
  }

  const answers = await Promise.all([
    orEmpty("dashboard_onboarding_progress_failed", () => getOnboardingProgress(organizationId), {
      hasInvitedMembers: false,
      hasPublishedTemplate: false,
      hasSubmission: false,
    }),
    orEmpty(
      "dashboard_people_load_failed",
      async () => (await listOrganizationPeople(user.id, organizationId)).members,
      []
    ),
    can("tasks:view")
      ? orEmpty(
          "dashboard_tasks_load_failed",
          async () =>
            (
              await listTaskPage({
                ...actor,
                page: 1,
                pageSize: 50,
                sort: { direction: "asc", key: "due" },
                statuses: ["open", "in_progress"],
              })
            ).tasks,
          []
        )
      : null,
    canReview
      ? orEmpty(
          "dashboard_reviews_load_failed",
          async () =>
            (
              await listSubmissionPage({
                ...actor,
                page: 1,
                pageSize: PAGE,
                sort: { direction: "asc", key: "updated" },
                statuses: ["submitted", "in_review"],
              })
            ).submissions,
          []
        )
      : { ok: true, value: [] },
    can("submissions:view")
      ? orEmpty(
          "dashboard_own_submissions_load_failed",
          async () =>
            (
              await listSubmissionPage({
                ...actor,
                page: 1,
                pageSize: PAGE,
                createdBy: user.id,
                sort: { direction: "desc", key: "updated" },
                statuses: ["needs_changes", "draft"],
              })
            ).submissions,
          []
        )
      : { ok: true, value: [] },
    can("submissions:view")
      ? orEmpty(
          "dashboard_workflow_load_failed",
          async () => {
            const [active, completed] = await Promise.all([
              countSubmissionsByStatus({
                ...actor,
                // External reviewers never see drafts, so theirs would always read 0.
                statuses: [
                  ...(role === "external_reviewer" ? [] : (["draft"] as const)),
                  "submitted",
                  "in_review",
                  "needs_changes",
                  "approved",
                ],
              }),
              countSubmissionsByStatus({
                ...actor,
                statuses: ["completed"],
                updatedSince: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
              }),
            ])
            return { ...active, ...completed }
          },
          {}
        )
      : null,
    can("documents:view")
      ? orEmpty(
          "dashboard_files_load_failed",
          async () => {
            const [recent, generated] = await Promise.all([
              listRecentDocuments({ ...actor, limit: 3 }),
              listRecentDocuments({ ...actor, generatedBy: user.id, limit: PAGE }),
            ])
            const documentIds = [
              ...new Set(
                [...recent, ...generated]
                  .filter((document) => document.sourceKind === "generated")
                  .map((document) => document.id)
              ),
            ]
            const cards = documentIds.length
              ? await listDocumentCards({ ...actor, contentIds: [], documentIds })
              : []
            const statuses = new Map<string, GeneratedDocumentWorkflowStatus | null>(
              cards.map((card) => [card.id, card.workflowStatus])
            )

            return {
              awaitingSignatures: generated.filter(
                (document) => statuses.get(document.id) === "awaiting_signatures"
              ),
              recent,
              statuses,
            }
          },
          null
        )
      : null,
    can("audit_logs:view")
      ? orEmpty(
          "dashboard_activity_load_failed",
          async () =>
            (
              await listAuditLogPage({
                ...actor,
                page: 1,
                pageSize: 5,
                sort: { direction: "desc", key: "created" },
              })
            ).entries,
          []
        )
      : null,
  ])

  const [progress, members, tasks, reviews, own, counts, files, activity] = answers
  const unavailable = answers.some((answer) => answer !== null && !answer.ok)

  const onboardingSteps = [
    {
      id: "org",
      title: "Create a workspace",
      completed: true,
      href: "/dashboard",
      actionText: "Create",
    },
    {
      id: "people",
      title: "Invite your team",
      completed: progress.value.hasInvitedMembers,
      href: "/people",
      actionText: "Invite",
    },
    {
      id: "template",
      title: "Publish a template",
      completed: progress.value.hasPublishedTemplate,
      href: "/templates/new",
      actionText: "New template",
    },
    {
      id: "submission",
      title: "Collect a submission",
      completed: progress.value.hasSubmission,
      href: "/submissions",
      actionText: "Open submissions",
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl leading-none font-medium tracking-[-0.02em]">Dashboard</h1>
        <p className="text-[13px] text-muted-foreground">
          {today} · <span>{context.organization.name}</span>
        </p>
      </header>

      {onboardingSteps.some((step) => !step.completed) ? (
        <OnboardingChecklist
          sampleAction={seedSampleSubmissionsAction}
          sampleActionLabel={`Add ${SAMPLE_SUBMISSION_COUNT} sample submissions`}
          seedAction={seedStarterTemplatesAction}
          seedActionLabel={`Add ${STARTER_TEMPLATES.length} starter templates`}
          steps={onboardingSteps}
        />
      ) : null}

      <DashboardHome
        activity={activity ? describeActivity(activity.value, members.value, user.id, now) : null}
        degraded={unavailable}
        dueThisWeek={tasks ? selectDueThisWeek(tasks.value, members.value, user.id, now, can("tasks:assign")) : null}
        queue={buildQueue({
          actorUserId: user.id,
          awaitingSignatures: files?.value?.awaitingSignatures ?? [],
          canReview,
          members: members.value,
          now,
          submissions: [...reviews.value, ...own.value],
          tasks: tasks?.value ?? [],
        })}
        recentFiles={files?.value ? describeRecentFiles(files.value.recent, files.value.statuses, now) : null}
        workflow={
          counts
            ? {
                counts: counts.value,
                scope:
                  role === "staff"
                    ? "Your submissions"
                    : role === "external_reviewer"
                      ? "Assigned to you"
                      : "All submissions",
              }
            : null
        }
      />
    </div>
  )
}
