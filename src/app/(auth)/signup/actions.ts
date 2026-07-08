"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import { getAppUrlEnv } from "@/lib/env"
import { createClient } from "@/lib/supabase/server"

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

function getStringValue(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === "string" ? value : ""
}

function buildRedirect(pathname: string, params: Record<string, string>): string {
  const searchParams = new URLSearchParams(params)
  return `${pathname}?${searchParams.toString()}`
}

export async function signupAction(formData: FormData): Promise<void> {
  const parsed = signupSchema.safeParse({
    email: getStringValue(formData, "email"),
    password: getStringValue(formData, "password"),
  })

  if (!parsed.success) {
    redirect(
      buildRedirect("/signup", {
        error: "Enter a valid email and a password with at least 8 characters.",
      })
    )
  }

  let supabase: Awaited<ReturnType<typeof createClient>>
  let appUrl: ReturnType<typeof getAppUrlEnv>

  try {
    supabase = await createClient()
    appUrl = getAppUrlEnv()
  } catch (error: unknown) {
    console.error("signup_config_error", {
      reason: error instanceof Error ? error.message : "Unknown environment error",
    })
    redirect(buildRedirect("/signup", { error: "Supabase environment is not configured." }))
  }

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${appUrl.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  })

  if (error) {
    console.error("signup_failed", {
      email: parsed.data.email,
      reason: error.message,
    })
    redirect(buildRedirect("/signup", { error: error.message }))
  }

  if (data.session) {
    redirect("/dashboard")
  }

  redirect(
    buildRedirect("/login", {
      message: "Confirm your account, then sign in.",
    })
  )
}
