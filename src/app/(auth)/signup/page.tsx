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

import { signupAction } from "./actions"

type SignupSearchParams = Promise<{
  error?: string
}>

export default async function SignupPage({
  searchParams,
}: {
  searchParams: SignupSearchParams
}) {
  const params = await searchParams

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Create your BizFlow account</CardTitle>
        <CardDescription>
          Start an organization workspace for document collection and review.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={signupAction} className="flex flex-col gap-5">
          {params.error && (
            <Alert variant="destructive">
              <AlertTitle>Unable to create account</AlertTitle>
              <AlertDescription>{params.error}</AlertDescription>
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
                autoComplete="new-password"
                required
                minLength={8}
              />
              <FieldDescription>
                Use at least 8 characters. Organization setup comes next.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <Button type="submit" className="w-full">
            Create account
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <span className="text-sm text-muted-foreground">Already invited?</span>
        <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href="/login">
          Sign in
        </Link>
      </CardFooter>
    </Card>
  )
}

