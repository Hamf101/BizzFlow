"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildRedirect } from "@/lib/form-utils"
import { checkRateLimit, hashRateLimitKeyPart, RateLimitError } from "@/lib/rate-limit"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import { PublicFormServiceError } from "@/services/public-form-service"
import {
  type AnswerRequestSummary,
  listAnswerRequests,
  MAX_ANSWER_RECIPIENTS,
  resendAnswerRequest,
  revokeAnswerRequest,
  sendToAnswer,
  type SentAnswerRequest,
} from "@/services/send-to-answer-service"

const sourceSchema = z.union([
  z.object({ documentId: z.string().uuid(), kind: z.literal("document") }).strict(),
  z.object({ kind: z.literal("template"), templateId: z.string().uuid() }).strict(),
])
const sendSchema = z.object({
  emails: z.array(z.string().max(320)).max(MAX_ANSWER_RECIPIENTS * 2),
  source: sourceSchema,
})
const requestSchema = z.object({ linkId: z.string().uuid(), source: sourceSchema })

/** What the Send to answer dialog gets back: what was sent, and what this send became, or why not. */
export type AnswerRequestsResult =
  | { ok: true; requests: AnswerRequestSummary[]; sent: SentAnswerRequest[] }
  | { message: string; ok: false }

type Who = { actorUserId: string; organizationId: string }
type Source = z.infer<typeof sourceSchema>

/**
 * Lists whom a document or template was sent to answer.
 *
 * @param source - The document or template.
 * @returns Each person's request, or a plain-words reason they cannot be shown.
 */
export async function loadAnswerRequestsAction(source: Source): Promise<AnswerRequestsResult> {
  const parsed = sourceSchema.safeParse(source)

  return parsed.success ? run(parsed.data, async () => []) : misunderstood
}

/**
 * Sends a document or template to people to answer, each by their own emailed link.
 *
 * @param input - What, and the addresses.
 * @returns What was sent afterwards, with any link whose email could not go.
 */
export async function sendToAnswerAction(input: z.infer<typeof sendSchema>): Promise<AnswerRequestsResult> {
  const parsed = sendSchema.safeParse(input)

  if (!parsed.success) {
    return misunderstood
  }

  const { emails, source } = parsed.data

  return run(source, async (who) => {
    // Every address is an email sent, so each spends the sender's budgets and its own.
    for (const email of new Set(emails.map((address) => address.trim().toLowerCase()).filter(Boolean))) {
      await checkRateLimit("outbound_email", who.actorUserId)
      await checkRateLimit("outbound_email_daily", who.actorUserId)
      await checkRateLimit("email_recipient", hashRateLimitKeyPart(email))
    }

    return sendToAnswer({ ...who, emails, source })
  })
}

/**
 * Sends someone a new link, retiring the old one.
 *
 * @param input - The request, and what it was sent from.
 * @returns What was sent afterwards, with the new link if its email could not go.
 */
export async function resendAnswerRequestAction(input: z.infer<typeof requestSchema>): Promise<AnswerRequestsResult> {
  const parsed = requestSchema.safeParse(input)

  if (!parsed.success) {
    return misunderstood
  }

  const { linkId, source } = parsed.data

  return run(source, async (who) => {
    await checkRateLimit("outbound_email", who.actorUserId)
    await checkRateLimit("outbound_email_daily", who.actorUserId)
    // The address is not known here; the link stands in for it.
    await checkRateLimit("email_recipient", linkId)

    return [await resendAnswerRequest({ ...who, linkId })]
  })
}

/**
 * Stops a request's link from taking answers.
 *
 * @param input - The request, and what it was sent from.
 * @returns What was sent afterwards.
 */
export async function revokeAnswerRequestAction(input: z.infer<typeof requestSchema>): Promise<AnswerRequestsResult> {
  const parsed = requestSchema.safeParse(input)

  if (!parsed.success) {
    return misunderstood
  }

  const { linkId, source } = parsed.data

  return run(source, async (who) => {
    await revokeAnswerRequest({ ...who, linkId })
    return []
  })
}

const misunderstood: AnswerRequestsResult = { message: "That could not be understood. Try again.", ok: false }

async function run(source: Source, operation: (who: Who) => Promise<SentAnswerRequest[]>): Promise<AnswerRequestsResult> {
  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      return { message: "Create or join a workspace first.", ok: false }
    }

    const who = { actorUserId: user.id, organizationId: context.organization.id }
    const sent = await operation(who)

    return { ok: true, requests: await listAnswerRequests({ ...who, source }), sent }
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/documents" }))
    }

    if (error instanceof PublicFormServiceError) {
      return { message: error.message, ok: false }
    }

    if (error instanceof RateLimitError) {
      return { message: "Too many emails for now. Try again later.", ok: false }
    }

    console.error("send_to_answer_action_failed", { reason: error instanceof Error ? error.message : "Unknown error" })

    return { message: "That could not be sent. Try again.", ok: false }
  }
}
