"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import {
  GeneratedDocumentFormDataError,
  parseGeneratedDocumentAnswers,
} from "@/components/documents/generated-document-form-data"
import { getClientIp } from "@/lib/client-ip"
import { getFormString } from "@/lib/form-utils"
import {
  getPublicFormDraftCookieOptions,
  PUBLIC_FORM_DRAFT_COOKIE_NAME,
} from "@/lib/public-form-draft-cookie"
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit"
import {
  PublicFormServiceError,
  submitPublicForm,
} from "@/services/public-form-service"

/**
 * Validates and finalizes one public form submission from browser FormData.
 *
 * @param formData - Public token, optimistic draft identity, and visible fields.
 * @returns Never returns normally because both success and failure redirect.
 */
export async function submitPublicFormAction(
  formData: FormData
): Promise<void> {
  const token = getFormString(formData, "token")
  const draftToken = getFormString(formData, "draftToken")
  const rawDraftRevision = getFormString(formData, "draftRevision")
  const draftRevision = Number(rawDraftRevision)
  const formPath = `/forms/${encodeURIComponent(token)}`

  const reqHeaders = await headers()
  const clientIp = getClientIp(reqHeaders)

  try {
    await checkRateLimit("public_form_submission", clientIp)

    // The page posts answers under the document's own names. File completion
    // is proven by verified `submission_files` rows keyed to the draft, never
    // by file metadata the browser claims here.
    const values = parseGeneratedDocumentAnswers(formData)

    await submitPublicForm({
      token,
      draftToken: draftToken === "" ? null : draftToken,
      expectedRevision:
        draftToken !== "" && Number.isInteger(draftRevision)
          ? draftRevision
          : null,
      values,
    })
  } catch (error: unknown) {
    const message =
      error instanceof PublicFormServiceError || error instanceof GeneratedDocumentFormDataError
        ? error.message
        : error instanceof RateLimitError
          ? "Too many requests. Try again shortly."
          : "Unable to complete your submission. Please try again."

    if (/^[0-9a-f]{64}$/.test(draftToken)) {
      const cookieStore = await cookies()
      cookieStore.set(
        PUBLIC_FORM_DRAFT_COOKIE_NAME,
        draftToken,
        getPublicFormDraftCookieOptions(token)
      )
    }

    redirect(`${formPath}?error=${encodeURIComponent(message)}`)
  }

  const cookieStore = await cookies()
  cookieStore.set(PUBLIC_FORM_DRAFT_COOKIE_NAME, "", {
    ...getPublicFormDraftCookieOptions(token),
    maxAge: 0,
  })
  redirect(`${formPath}/success`)
}
