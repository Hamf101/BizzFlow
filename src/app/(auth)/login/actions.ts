"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  next: z.string().optional(),
})

function getStringValue(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === "string" ? value : ""
}

function buildRedirect(pathname: string, params: Record<string, string>): string {
  const searchParams = new URLSearchParams(params)
  return `${pathname}?${searchParams.toString()}`
}

export async function loginAction(formData: FormData): Promise<void> {
  const parsed = loginSchema.safeParse({
    email: getStringValue(formData, "email"),
    password: getStringValue(formData, "password"),
    next: getStringValue(formData, "next") || undefined,
  })

  if (!parsed.success) {
    redirect(
      buildRedirect("/login", {
        error: "Enter a valid email and a password with at least 8 characters.",
      })
    )
  }

  let supabase: Awaited<ReturnType<typeof createClient>>

  try {
    supabase = await createClient()
  } catch (error: unknown) {
    console.error("login_config_error", {
      reason: error instanceof Error ? error.message : "Unknown environment error",
    })
    redirect(buildRedirect("/login", { error: "Supabase environment is not configured." }))
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    console.error("login_failed", {
      email: parsed.data.email,
      reason: error.message,
    })
    redirect(buildRedirect("/login", { error: "Invalid email or password." }))
  }

  redirect(parsed.data.next || "/dashboard")
}
