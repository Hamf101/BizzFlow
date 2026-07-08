import Link from "next/link"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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

import { loginAction } from "./actions"

type LoginSearchParams = Promise<{
  error?: string
  message?: string
  next?: string
}>

export default async function LoginPage({
  searchParams,
}: {
  searchParams: LoginSearchParams
}) {
  const params = await searchParams

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Sign in to BizFlow Docs</CardTitle>
        <CardDescription>
          Access your organization dashboard, submissions, and document workflows.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={loginAction} className="flex flex-col gap-5">
          <input type="hidden" name="next" value={params.next ?? ""} />
          {params.error && (
            <Alert variant="destructive">
              <AlertTitle>Unable to sign in</AlertTitle>
              <AlertDescription>{params.error}</AlertDescription>
            </Alert>
          )}
          {params.message && (
            <Alert>
              <AlertTitle>Check your email</AlertTitle>
              <AlertDescription>{params.message}</AlertDescription>
            </Alert>
          )}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
              />
              <FieldDescription>
                Use the password associated with your workspace invite.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <span className="text-sm text-muted-foreground">New workspace?</span>
        <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href="/signup">
          Create account
        </Link>
      </CardFooter>
    </Card>
  )
}

