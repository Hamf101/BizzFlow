"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { after } from "next/server"
import { z } from "zod"

import { enforceActionRateLimit } from "@/lib/action-rate-limit"
import { getClientIp } from "@/lib/client-ip"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import { hashRateLimitKeyPart } from "@/lib/rate-limit"
import { sendPasswordResetEmail } from "@/services/password-reset-service"

const requestSchema = z.object({ email: z.string().trim().email() })

/**
 * Asks for a link to choose a new password. The reply reads the same whether
 * or not the address has an account, and the email goes out after the reply,
 * so neither the words nor the timing say who has signed up.
 *
 * @param formData - The form, with the email address.
 * @returns Never returns; redirects to the confirmation or an error.
 */
export async function requestPasswordResetAction(formData: FormData): Promise<void> {
  const parsed = requestSchema.safeParse({ email: getFormString(formData, "email") })

  if (!parsed.success) {
    redirect(buildRedirect("/forgot-password", { error: "Enter the email address you log in with." }))
  }

  const email = parsed.data.email.toLowerCase()

  await enforceActionRateLimit({
    bucket: "auth",
    key: getClientIp(await headers()),
    message: "Too many requests. Try again in a few minutes.",
    redirectPath: "/forgot-password",
  })
  // Keeps anyone from filling someone else's inbox with links.
  await enforceActionRateLimit({
    bucket: "email_recipient",
    key: hashRateLimitKeyPart(email),
    message: "Too many requests for this address. Try again in an hour.",
    redirectPath: "/forgot-password",
  })

  after(() => sendPasswordResetEmail({ email }))
  redirect(buildRedirect("/forgot-password", { sent: "1" }))
}
