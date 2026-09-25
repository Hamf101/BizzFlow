import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { AuthPageCard } from "@/lib/page-auth-card"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"

import { createOrganizationAction } from "@/app/(dashboard)/dashboard/actions"

type WelcomeSearchParams = Promise<{
  error?: string
}>

/**
 * The last step of signing up: naming the workspace the new account will own.
 * It sits with the other sign-in pages, so the backdrop keeps building.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: WelcomeSearchParams
}): Promise<ReactElement> {
  const user = await loadAuthenticatedPageUser("/welcome")
  const { context, errorMessage } = await loadPageOrganizationContext({
    userId: user.id,
    failureEvent: "welcome_context_load_failed",
  })

  if (context) {
    redirect("/dashboard")
  }

  // Without knowing whether they already have a workspace, don't offer a second.
  if (errorMessage) {
    return (
      <AuthPageCard
        description={errorMessage}
        footer={
          <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href="/welcome">
            Try again
          </Link>
        }
        title="Unable to load your workspace"
      />
    )
  }

  const params = await searchParams

  return (
    <AuthPageCard
      description="It's where your team's templates, documents and submissions live."
      footer={
        <span className="text-sm text-muted-foreground">
          Joining a team? Open the link in your invite email instead.
        </span>
      }
      title="Name your workspace"
    >
      <form action={createOrganizationAction} className="flex flex-col gap-5">
        {params.error && (
          <Alert variant="destructive">
            <AlertTitle>Workspace not created</AlertTitle>
            <AlertDescription>{params.error}</AlertDescription>
          </Alert>
        )}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="name">Workspace name</FieldLabel>
            <Input
              autoComplete="organization"
              id="name"
              maxLength={120}
              minLength={2}
              name="name"
              required
              type="text"
            />
            <FieldDescription>
              Use the business name your team and customers know.
            </FieldDescription>
          </Field>
        </FieldGroup>
        <Button type="submit" className="w-full">
          Create workspace
        </Button>
      </form>
    </AuthPageCard>
  )
}
