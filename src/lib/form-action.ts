import { redirect } from "next/navigation"

import {
  buildFeedbackRedirect,
  getActionErrorFeedbackCode,
  type ActionFeedbackCode,
} from "@/lib/action-result"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildRedirect } from "@/lib/form-utils"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import type { Organization } from "@/types/organization"

/** A user-safe rejection a server action raises before any service runs. */
export class ActionError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = "ActionError"
    this.statusCode = statusCode
  }
}

/**
 * Reads a required identifier from a form.
 *
 * @param value - The submitted value.
 * @param label - User-safe name for the field.
 * @returns The trimmed identifier.
 * @throws ActionError (400) when it is blank.
 */
export function requireFormId(value: string, label: string): string {
  const identifier = value.trim()

  if (!identifier) {
    throw new ActionError(`${label} is required.`)
  }

  return identifier
}

/** Who acts, and in which organization: what every tenant service takes. */
export type ActionActor = { actorUserId: string; organizationId: string }

/**
 * Loads the signed-in member and their current organization. Each service
 * checks the actor's permission itself.
 *
 * @param noOrganization - Why the action needs an organization, for when there is none.
 * @param statusCode - The rejection's status: 428 asks for an organization.
 * @returns The actor to spread into a service call, and the organization.
 * @throws AuthenticationError when signed out; ActionError without an organization.
 */
export async function loadActionContext(
  noOrganization: string,
  statusCode = 428
): Promise<{ actor: ActionActor; organization: Organization }> {
  const user = await getAuthenticatedUser()
  const context = await getCurrentOrganizationContext(user.id)

  if (!context) {
    throw new ActionError(noOrganization, statusCode)
  }

  return {
    actor: { actorUserId: user.id, organizationId: context.organization.id },
    organization: context.organization,
  }
}

/**
 * {@link loadActionContext} for an action that returns data rather than
 * redirecting: a signed-out member is sent to sign in and back to `next`.
 *
 * @param next - Where signing in returns to.
 * @param noOrganization - Why the action needs an organization.
 * @param statusCode - The rejection's status without one.
 * @returns The actor and the organization.
 */
export async function loadActionContextOrSignIn(
  next: string,
  noOrganization: string,
  statusCode?: number
): ReturnType<typeof loadActionContext> {
  try {
    return await loadActionContext(noOrganization, statusCode)
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next }))
    }

    throw error
  }
}

type FormActionOptions = {
  /** Log prefix: `<event>_completed` and `<event>_failed`. */
  event: string
  /** Where a failure returns, and where signing in again comes back to. */
  path: string
  /** The outcome shown on success. */
  success: ActionFeedbackCode
  /** Safe identifiers for the logs. */
  log?: Readonly<Record<string, string | number | null | undefined>>
  /** A failure's own outcome; undefined falls back to its status code. */
  failure?: (error: unknown) => ActionFeedbackCode | undefined
  /** Does the work; may name a different success path or outcome. */
  run: () => Promise<void | { path?: string; code?: ActionFeedbackCode }>
}

/**
 * Runs one form action and redirects with how it went: to sign-in when the
 * session ended, back to `path` with a fixed outcome code on failure, and on
 * with the success code otherwise. No exception text reaches the page.
 *
 * @param options - The work, its paths and outcomes, and its log identity.
 * @returns Never returns; always redirects.
 */
export async function runFormAction(options: FormActionOptions): Promise<never> {
  const startedAt = Date.now()
  let outcome: { path?: string; code?: ActionFeedbackCode } | void

  try {
    outcome = await options.run()
    console.info(`${options.event}_completed`, {
      ...options.log,
      durationMs: Date.now() - startedAt,
    })
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: options.path }))
    }

    console.warn(`${options.event}_failed`, {
      ...options.log,
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : "Unknown action error",
    })
    redirect(
      buildFeedbackRedirect(
        options.path,
        options.failure?.(error) ?? getActionErrorFeedbackCode(error)
      )
    )
  }

  // Outside the try: redirect() throws NEXT_REDIRECT, which a catch would
  // turn into a failure.
  redirect(
    buildFeedbackRedirect(
      outcome?.path ?? options.path,
      outcome?.code ?? options.success
    )
  )
}
