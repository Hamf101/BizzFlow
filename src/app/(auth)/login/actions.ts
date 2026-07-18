"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import { getSafeNextPath } from "@/lib/auth-redirects"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import { createClient } from "@/lib/supabase/server"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  next: z.string().optional(),
})

export async function loginAction(formData: FormData): Promise<void> {
  const parsed = loginSchema.safeParse({
    email: getFormString(formData, "email"),
    password: getFormString(formData, "password"),
    next: getFormString(formData, "next") || undefined,
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
    console.warn("login_rejected", {
      errorCode: error.code ?? "auth_error",
      statusCode: error.status,
    })
    redirect(buildRedirect("/login", { error: "Invalid email or password." }))
  }

  redirect(getSafeNextPath(parsed.data.next, "/dashboard"))
}
