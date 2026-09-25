"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import { enforceActionRateLimit } from "@/lib/action-rate-limit"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildAcceptInvitePath } from "@/lib/auth-redirects"
import { getClientIp } from "@/lib/client-ip"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import { createClient } from "@/lib/supabase/server"
import {
  acceptInvite,
  createInvitedAccount,
  getInvitePreview,
  OrganizationServiceError,
} from "@/services/organization-service"
import { newPasswordSchema } from "@/types/password"

const joinSchema = z.object({
  account: z.enum(["existing", "new"]),
  password: z.string().min(8, "Use at least 8 characters."),
  token: z.string().min(1),
})

/**
 * Joins the workspace as the account already signed in.
 *
 * @param formData - The invite token.
 * @returns Never returns; redirects to the dashboard or back with the reason.
 */
export async function acceptInviteAction(formData: FormData): Promise<void> {
  const token = getFormString(formData, "token")
  const invitePath = buildAcceptInvitePath(token)

  if (!token) {
    redirect(buildRedirect("/login", { error: "Invite token is missing." }))
  }

  try {
    const user = await getAuthenticatedUser()
    await acceptInvite({
      userId: user.id,
      userEmail: user.email,
      token,
    })
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(invitePath)
    }

    redirect(buildRedirect(invitePath, { error: describeFailure(error) }))
  }

  redirect(buildFeedbackRedirect("/dashboard", "invite_accepted"))
}

/**
 * Joins the workspace in one step from a signed-out browser: opens an account
 * for someone new, or signs in someone who already has one, then accepts.
 *
 * @param formData - The invite token, whether they have an account, and a password (twice when new).
 * @returns Never returns; redirects to the dashboard or back with the reason.
 */
export async function joinWithPasswordAction(formData: FormData): Promise<void> {
  const token = getFormString(formData, "token")
  const invitePath = buildAcceptInvitePath(token)
  function back(error: string, account: string): never {
    redirect(buildRedirect(invitePath, { error, ...(account === "existing" ? { account } : {}) }))
  }
  const parsed = joinSchema.safeParse({
    account: getFormString(formData, "account"),
    password: getFormString(formData, "password"),
    token,
  })

  if (!parsed.success) {
    back(parsed.error.issues[0]?.message ?? "Check the form and try again.", getFormString(formData, "account"))
  }

  const { account, password } = parsed.data
  // Someone new chooses a password here, so it meets every rule and is typed twice.
  const chosen = account === "new" && newPasswordSchema.safeParse({ confirm: getFormString(formData, "confirm"), password })

  if (chosen && !chosen.success) {
    back(chosen.error.issues[0]?.message ?? "Check the password and try again.", account)
  }

  await enforceActionRateLimit({
    bucket: "auth",
    key: getClientIp(await headers()),
    redirectPath: invitePath,
    message: "Too many attempts. Try again in a few minutes.",
  })

  let email: string
  let hadAccount = account === "existing"

  try {
    if (account === "new") {
      const opened = await createInvitedAccount({ password, token })
      email = opened.email
      hadAccount = opened.existing
    } else {
      email = (await getInvitePreview(token)).email
    }
  } catch (error: unknown) {
    back(describeFailure(error), account)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    console.warn("invite_join_sign_in_failed", { errorCode: error?.code ?? "no_user", hadAccount })
    back(
      error?.code === "email_not_confirmed"
        ? "Confirm your email first: open the link we sent when you signed up."
        : hadAccount && account === "new"
          ? "You already have a BizFlow account. Enter its password to join."
          : "That password doesn't match your BizFlow account.",
      "existing"
    )
  }

  try {
    await acceptInvite({ token, userEmail: data.user.email, userId: data.user.id })
  } catch (error: unknown) {
    back(describeFailure(error), "existing")
  }

  redirect(buildFeedbackRedirect("/dashboard", "invite_accepted"))
}

/**
 * Signs out an account the invite isn't for, so its owner can join.
 *
 * @param formData - The invite token.
 * @returns Never returns; reopens the invite.
 */
export async function switchInviteAccountAction(formData: FormData): Promise<void> {
  const supabase = await createClient()
  // Only this browser: their other devices stay logged in.
  await supabase.auth.signOut({ scope: "local" })
  redirect(buildAcceptInvitePath(getFormString(formData, "token")))
}

function describeFailure(error: unknown): string {
  const logContext = { reason: error instanceof Error ? error.message : "Unknown invite error" }

  if (error instanceof OrganizationServiceError) {
    console.warn("accept_invite_action_failed", logContext)
    return error.statusCode === 404 ? "This invite has expired or was already used." : error.message
  }

  console.error("accept_invite_action_failed", logContext)
  return "Unable to join the workspace. Try again."
}
