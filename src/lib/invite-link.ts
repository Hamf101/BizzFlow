import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import { enforceActionRateLimit } from "@/lib/action-rate-limit"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { getClientIp } from "@/lib/client-ip"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import { createClient } from "@/lib/supabase/server"
import { updateProfile } from "@/services/organization-service"
import { newPasswordSchema } from "@/types/password"
import { profileSchema } from "@/types/profile"

/**
 * One emailed link answered from a public page: a workspace invite or a shared
 * document. Each route builds this from the link's token.
 */
export type InviteLink = {
  /** The link's own page, where every failure goes back to. */
  path: string
  /** Prefix for this route's log events. */
  event: string
  /** Opens an account for the link's address, saying whether one already used it. */
  openAccount: (password: string) => Promise<{ email: string; existing: boolean }>
  /** The address the link was sent to. */
  findEmail: () => Promise<string>
  /** Accepts the link as this account, resolving to where they land next. */
  accept: (user: { email: string | null; id: string }) => Promise<string>
  /** User text for a failure the service explained, or undefined for an unexpected one. */
  explain: (error: unknown) => string | undefined
  /** User text for an unexpected failure. */
  fallback: string
}

const joinSchema = z.object({
  account: z.enum(["existing", "new"]),
  password: z.string().min(8, "Use at least 8 characters."),
  token: z.string().min(1),
})

/**
 * Accepts a link as the account already signed in.
 *
 * @param formData - The link's token.
 * @param toLink - Builds the route's link from its token.
 * @returns Never returns; redirects onward or back with the reason.
 */
export async function acceptInviteLink(formData: FormData, toLink: (token: string) => InviteLink): Promise<never> {
  const token = getFormString(formData, "token")
  const link = toLink(token)

  if (!token) {
    redirect(buildRedirect("/login", { error: "This link is incomplete. Open it from the email again." }))
  }

  let destination: string

  try {
    const user = await getAuthenticatedUser()
    destination = await link.accept({ email: user.email, id: user.id })
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(link.path)
    }

    redirect(buildRedirect(link.path, { error: describeFailure(link, error) }))
  }

  redirect(destination)
}

/**
 * Answers a link in one step from a signed-out browser: opens an account for
 * someone new, or signs in someone who already has one, then accepts.
 *
 * @param formData - The token, whether they have an account, a password (twice when new), and someone new's name and optional phone.
 * @param toLink - Builds the route's link from its token.
 * @returns Never returns; redirects onward or back with the reason.
 */
export async function joinInviteLinkWithPassword(
  formData: FormData,
  toLink: (token: string) => InviteLink
): Promise<never> {
  const token = getFormString(formData, "token")
  const link = toLink(token)
  function back(error: string, account: string): never {
    redirect(buildRedirect(link.path, { error, ...(account === "existing" ? { account } : {}) }))
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

  // Someone new says who they are, too; it's checked before any account opens.
  const profile =
    account === "new" &&
    profileSchema.safeParse({
      displayName: getFormString(formData, "displayName"),
      phoneNumber: getFormString(formData, "phoneNumber"),
    })

  if (profile && !profile.success) {
    back(profile.error.issues[0]?.message ?? "Check your details and try again.", account)
  }

  await enforceActionRateLimit({
    bucket: "auth",
    key: getClientIp(await headers()),
    redirectPath: link.path,
    message: "Too many attempts. Try again in a few minutes.",
  })

  let email: string
  let hadAccount = account === "existing"

  try {
    if (account === "new") {
      const opened = await link.openAccount(password)
      email = opened.email
      hadAccount = opened.existing
    } else {
      email = await link.findEmail()
    }
  } catch (error: unknown) {
    back(describeFailure(link, error), account)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    console.warn(`${link.event}_sign_in_failed`, { errorCode: error?.code ?? "no_user", hadAccount })
    back(
      error?.code === "email_not_confirmed"
        ? "Confirm your email first: open the link we sent when you signed up."
        : hadAccount && account === "new"
          ? "You already have a BizFlow account. Enter its password to continue."
          : "That password doesn't match your BizFlow account.",
      "existing"
    )
  }

  let destination: string

  try {
    destination = await link.accept({ email: data.user.email ?? null, id: data.user.id })
  } catch (error: unknown) {
    back(describeFailure(link, error), "existing")
  }

  // The name follows the account. One that fails to save (the service logs
  // why) can go in from Settings; they're in either way.
  if (profile) {
    await updateProfile({ actorUserId: data.user.id, ...profile.data }).catch(() => undefined)
  }

  redirect(destination)
}

/**
 * Signs out an account the link isn't for, so its owner can answer it.
 *
 * @param formData - The link's token.
 * @param toLink - Builds the route's link from its token.
 * @returns Never returns; reopens the link.
 */
export async function switchInviteLinkAccount(
  formData: FormData,
  toLink: (token: string) => InviteLink
): Promise<never> {
  const supabase = await createClient()
  // Only this browser: their other devices stay logged in.
  await supabase.auth.signOut({ scope: "local" })
  redirect(toLink(getFormString(formData, "token")).path)
}

function describeFailure(link: InviteLink, error: unknown): string {
  const logContext = { reason: error instanceof Error ? error.message : "Unknown link error" }
  const message = link.explain(error)

  if (message !== undefined) {
    console.warn(`${link.event}_action_failed`, logContext)
    return message
  }

  console.error(`${link.event}_action_failed`, logContext)
  return link.fallback
}
