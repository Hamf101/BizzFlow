import Link from "next/link"
import { redirect } from "next/navigation"
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
import {
  AuthenticationError,
  getAuthenticatedUser,
  type AuthenticatedUser,
} from "@/lib/auth"
import { buildRedirect } from "@/lib/form-utils"
import { getCurrentOrganizationContext } from "@/services/organization-service"

import { createOrganizationAction } from "./actions"

type DashboardSearchParams = Promise<{
  error?: string
  message?: string
}>

const sprintItems: readonly string[] = [
  "Create the first organization workspace.",
  "Invite staff and assign MVP roles.",
  "Accept pending organization invites.",
  "Prepare tenant data for stricter Sprint 3 permission tests.",
]

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: DashboardSearchParams
}): Promise<ReactElement> {
  const params = await searchParams
  const user = await loadDashboardUser()
  const { context, errorMessage: contextErrorMessage } =
    await getCurrentOrganizationContext(user.id)
      .then((context) => ({ context, errorMessage: null as string | null }))
      .catch((error: unknown) => {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Unable to load organization context."

        console.warn("dashboard_context_load_failed", {
          userId: user.id,
          reason: errorMessage,
        })

        return {
          context: null,
          errorMessage,
        }
      })

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-normal">Dashboard</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Signed in as {user.email ?? "Authenticated user"}. Sprint 3 hardens
          organization permissions, role checks, and audit visibility.
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
            <CardTitle>Sprint 2 checklist</CardTitle>
            <CardDescription>What this implementation slice makes usable.</CardDescription>
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
            <CardDescription>Sprint 3 hardens tenant permissions.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              The next implementation slice expands RLS coverage, adds
              server-side permission tests, and introduces role-based UI guards.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

async function loadDashboardUser(): Promise<AuthenticatedUser> {
  try {
    return await getAuthenticatedUser()
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/dashboard" }))
    }

    throw error
  }
}
