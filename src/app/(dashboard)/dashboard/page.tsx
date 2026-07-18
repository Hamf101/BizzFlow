import Link from "next/link"
import type { ReactElement } from "react"

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

import { createOrganizationAction } from "./actions"

type DashboardSearchParams = Promise<{
  error?: string
  message?: string
}>

const sprintItems: readonly string[] = [
  "Assign submitted work to an eligible reviewer.",
  "Request changes and safely resubmit revised answers or files.",
  "Approve, reject, and complete work with revision protection.",
  "Keep required feedback, comments, and activity in one history.",
]

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

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-normal">Dashboard</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Signed in as {user.email ?? "Authenticated user"}. Sprint 8 adds a
          tenant-safe assignment and review workflow for internal submissions.
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
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Sprint 8 checklist</CardTitle>
            <CardDescription>
              Submission review capabilities available in this slice.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3 text-sm">
              {sprintItems.map((item: string) => (
                <li className="rounded-lg border bg-background p-3" key={item}>
                  {item}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Next build target</CardTitle>
            <CardDescription>Tasks and reminders come next.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Sprint 9 turns reviewed submissions into assigned work with due
              dates, reminder processing, and notification delivery.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
