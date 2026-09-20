import Link from "next/link"

import { PasswordInput } from "@/components/auth/password-input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { AuthPageCard } from "@/lib/page-auth-card"

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
    <AuthPageCard
      footer={
        <>
          <span className="text-sm text-muted-foreground">New to BizFlow?</span>
          <Link
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            href="/signup"
          >
            Sign up
          </Link>
        </>
      }
      footerClassName="justify-between gap-3"
      title="Log in to BizFlow"
    >
      <form action={loginAction} className="flex flex-col gap-5">
        <input type="hidden" name="next" value={params.next ?? ""} />
        {params.error && (
          <Alert variant="destructive">
            <AlertTitle>Unable to log in</AlertTitle>
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
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              required
              minLength={8}
            />
          </Field>
        </FieldGroup>
        <Button type="submit" className="w-full">
          Log in
        </Button>
      </form>
    </AuthPageCard>
  )
}
