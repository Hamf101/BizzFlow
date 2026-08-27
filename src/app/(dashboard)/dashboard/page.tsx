import Link from "next/link"
import type { ReactElement } from "react"

import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import {
  getOnboardingProgress,
  type OnboardingProgress,
} from "@/services/organization-service"

import {
  SAMPLE_SUBMISSION_COUNT,
  STARTER_TEMPLATES,
} from "@/services/templates/starter-templates"

import {
  createOrganizationAction,
  seedSampleSubmissionsAction,
  seedStarterTemplatesAction,
} from "./actions"

type DashboardSearchParams = Promise<{
  error?: string
  message?: string
}>

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: DashboardSearchParams
}): Promise<ReactElement> {
  const params = await searchParams
  const user = await loadAuthenticatedPageUser("/dashboard")
  const { context, errorMessage: contextErrorMessage } =
    await loadPageOrganizationContext({
      userId: user.id,
      failureEvent: "dashboard_context_load_failed",
    })

  // Derived from real tenant data; a failure degrades to "not yet done" rather
  // than breaking the dashboard.
  const progress: OnboardingProgress = context
    ? await getOnboardingProgress(context.organization.id).catch(
        (error: unknown) => {
          console.warn("dashboard_onboarding_progress_failed", {
            organizationId: context.organization.id,
            reason: error instanceof Error ? error.message : "Unknown error",
          })
          return {
            hasInvitedMembers: false,
            hasPublishedTemplate: false,
            hasSubmission: false,
          }
        }
      )
    : {
        hasInvitedMembers: false,
        hasPublishedTemplate: false,
        hasSubmission: false,
      }

  const onboardingSteps = [
    {
      id: "org",
      title: "Create Organization Workspace",
      description: "Establish tenant boundaries for document security.",
      completed: Boolean(context),
      href: "/dashboard",
      actionText: "Setup Org",
    },
    {
      id: "people",
      title: "Invite Team Members",
      description: "Add staff and assign workspace roles.",
      completed: progress.hasInvitedMembers,
      href: "/people",
      actionText: "Invite Members",
    },
    {
      id: "template",
      title: "Publish Form Template",
      description: "Create fillable guided document templates.",
      completed: progress.hasPublishedTemplate,
      href: "/templates/new",
      actionText: "New Template",
    },
    {
      id: "submission",
      title: "Submit & Review Work",
      description: "Collect files and process review decisions.",
      completed: progress.hasSubmission,
      href: "/submissions",
      actionText: "View Submissions",
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-normal">Dashboard</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Signed in as {user.email ?? "Authenticated user"}. Welcome to BizFlow Document Studio.
        </p>
      </section>

      {params.error && (
        <Alert variant="destructive">
          <AlertTitle>Dashboard action failed</AlertTitle>
          <AlertDescription>{params.error}</AlertDescription>
        </Alert>
      )}

      {params.message && (
        <Alert>
          <AlertTitle>Dashboard updated</AlertTitle>
          <AlertDescription>{params.message}</AlertDescription>
        </Alert>
      )}

      {contextErrorMessage && (
        <Alert variant="destructive">
          <AlertTitle>Supabase setup incomplete</AlertTitle>
          <AlertDescription>{contextErrorMessage}</AlertDescription>
        </Alert>
      )}

      {!context && !contextErrorMessage && (
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

      {context && (
        <>
          <OnboardingChecklist
            sampleAction={seedSampleSubmissionsAction}
            sampleActionLabel={`Add ${SAMPLE_SUBMISSION_COUNT} sample submissions`}
            seedAction={seedStarterTemplatesAction}
            seedActionLabel={`Add ${STARTER_TEMPLATES.length} starter templates`}
            steps={onboardingSteps}
          />

          <Card>
            <CardHeader>
              <CardTitle>{context.organization.name}</CardTitle>
              <CardDescription>
                Current workspace for forms, documents, tasks, and reminders.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm md:grid-cols-3">
              <div className="flex flex-col gap-1 rounded-lg border bg-background p-3">
                <span className="text-muted-foreground">Role</span>
                <Badge variant="secondary">{context.membership.role}</Badge>
              </div>
              <div className="flex flex-col gap-1 rounded-lg border bg-background p-3">
                <span className="text-muted-foreground">Slug</span>
                <span className="font-medium">{context.organization.slug}</span>
              </div>
              <div className="flex flex-col gap-1 rounded-lg border bg-background p-3">
                <span className="text-muted-foreground">Status</span>
                <Badge variant="outline">{context.membership.status}</Badge>
              </div>
            </CardContent>
            <CardFooter>
              <Link
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                href="/people"
              >
                Manage people
              </Link>
            </CardFooter>
          </Card>
        </>
      )}
    </div>
  )
}
