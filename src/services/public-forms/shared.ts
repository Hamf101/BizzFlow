import { createHmac, randomBytes } from "node:crypto"

import * as z from "zod"

import { createAdminClient } from "@/lib/supabase/admin"
import { type RecordAuditLogInput } from "@/services/audit-service"
import { hashToken } from "@/services/document-signing/token-security"
import { type LogValue, runOperation } from "@/services/operation"
import {
  createSignedSubmissionUploadUrl as defaultCreateSignedSubmissionUploadUrl,
  verifySubmissionUpload as defaultVerifySubmissionUpload,
} from "@/services/submission-storage-service"
import type { PublicFormLink } from "@/types/public-link"
import { parsePublicFormLinkRow } from "@/types/public-link"
import type { DocumentTemplate, TemplateContent } from "@/types/template"
import { type TemplateAccessInput } from "@/services/templates/access"
import { TemplateServiceError } from "@/services/templates/errors"
import { ServiceError } from "@/services/service-error"

/**
 * Retention marker written when a public upload is allocated.
 *
 * `submission_files.cleanup_after` is immutable once a row leaves
 * `upload_pending` (see enforce_submission_file_update), and the scheduled
 * cleanup only reclaims `superseded` objects, so this value is set once here.
 * The nightly expiry supersedes an upload once this window has elapsed, and
 * every file of a public draft nobody has saved or uploaded to for as long.
 */
export const PUBLIC_UPLOAD_CLEANUP_MS = 24 * 60 * 60 * 1000

export function generateDraftToken(): string {
  return randomBytes(32).toString("hex")
}

export class PublicFormServiceError extends ServiceError {
  override readonly name = "PublicFormServiceError"
}

export const FORM_CHANGED = "This form changed after you opened it. Reload and try again."

export const DRAFT_CHANGED = "This form draft changed in another tab. Reload and try again."

/**
 * The token of a link for anyone: its id signed with PUBLIC_LINK_SECRET, so
 * the link keeps only the token's hash and its editor can still copy it. The
 * secret is its own so rotating the Supabase key leaves every link copyable;
 * changing this one turns every Copy link into a dead address.
 *
 * @param linkId - The link's id.
 * @returns A 256-bit base64url token.
 * @throws PublicFormServiceError when the server has no secret.
 */
export function derivePublicLinkToken(linkId: string): string {
  const secret = process.env.PUBLIC_LINK_SECRET?.trim()

  if (!secret || secret.length < 32) {
    throw new PublicFormServiceError("Public form links are not configured.", 500)
  }

  return createHmac("sha256", secret).update(JSON.stringify(["bizflow-public-link", linkId])).digest("base64url")
}

export type CreatePublicFormLinkInput = TemplateAccessInput & {
  expiresAt?: string | null
  /** Where the link is used, such as "Front desk". */
  label?: string | null
  maxSubmissions?: number | null
}

export type DisablePublicFormLinkInput = TemplateAccessInput & {
  linkId: string
}

export type PublicFormLinkPreview = {
  valid: boolean
  invalidReason:
    | "not_found"
    | "disabled"
    | "expired"
    | "max_submissions_reached"
    | null
  link: PublicFormLink | null
  template: DocumentTemplate | null
  organizationName: string | null
  /** The answers already in a document sent to answer, shown filled in. */
  answers: Record<string, unknown>
}

export type SubmitPublicFormInput = {
  token: string
  draftToken?: string | null
  expectedRevision?: number | null
  title?: string
  values: Record<string, unknown>
}

export type PublicSubmissionResult = {
  submissionId: string
  organizationId: string
  status: string
  submittedAt: string
}

export type CreatePublicFormFileUploadUrlInput = {
  token: string
  draftToken?: string | null
  fieldKey: string
  originalFilename: string
  contentType: string
  byteSize: number
  checksumSha256: string
}

export type SavePublicFormDraftInput = {
  token: string
  draftToken?: string | null
  expectedRevision?: number | null
  values: Record<string, unknown>
}

export type PublicFormDraftCheckpoint = {
  activeFileFieldKeys: string[]
  draftToken: string
  revision: number
}

export type PublicFormDraftFile = {
  fileId: string
  fieldKey: string
  originalFilename: string
}

export type PublicFormDraftState = PublicFormDraftCheckpoint & {
  values: Record<string, unknown>
  files: PublicFormDraftFile[]
}

export type CreatePublicFormFileUploadUrlResponse = {
  fileId: string
  draftToken: string
  uploadUrl: string
  safeFilename: string
  expiresInSeconds: number
}

export type CompletePublicFormFileUploadInput = {
  token: string
  draftToken: string
  fileId: string
}

export type SupersedePublicFormFileInput = {
  token: string
  draftToken: string
  fileId: string
}

export type PublicFormServiceDeps = {
  client?: ReturnType<typeof createAdminClient>
  linkToken?: (linkId: string) => string
  generateDraftTokenImpl?: () => string
  createId?: () => string
  now?: () => Date
  createSignedSubmissionUploadUrl?: typeof defaultCreateSignedSubmissionUploadUrl
  verifySubmissionUpload?: typeof defaultVerifySubmissionUpload
  recordAuditLog?: (input: RecordAuditLogInput) => Promise<unknown>
}

/** A public draft submission resolved from an anonymous visitor's handle. */
export type PublicDraft = {
  id: string
  organizationId: string
  linkId: string
  snapshot: TemplateContent
  values: Record<string, unknown>
  revision: number
}

export const uploadRequestSchema = z.object({
  fieldKey: z
    .string()
    .regex(
      /^[A-Za-z][A-Za-z0-9_-]{0,79}$/,
      "File field key is not valid for this form."
    ),
  originalFilename: z.string().trim().min(1).max(240),
  contentType: z.string().trim().min(1).max(180),
  byteSize: z.number().int().positive(),
  checksumSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "File checksum is invalid."),
})

export const draftTokenSchema = z.string().regex(/^[0-9a-f]{64}$/)

export const publicFileIdSchema = z.string().uuid()

export const publicDraftCheckpointSchema = z
  .object({
    draftToken: draftTokenSchema.nullable().optional(),
    expectedRevision: z.number().int().positive().nullable().optional(),
    values: z.record(z.string(), z.unknown()),
  })
  .superRefine((value, context) => {
    const hasDraftToken = typeof value.draftToken === "string"
    const hasExpectedRevision = typeof value.expectedRevision === "number"

    if (hasDraftToken !== hasExpectedRevision) {
      context.addIssue({
        code: "custom",
        message: "The public form draft revision is missing or invalid.",
        path: ["expectedRevision"],
      })
    }
  })

export function getClient(
  deps: PublicFormServiceDeps
): ReturnType<typeof createAdminClient> {
  return deps.client ?? createAdminClient()
}

export function nowIso(deps: PublicFormServiceDeps): string {
  return (deps.now ?? (() => new Date()))().toISOString()
}

export function createId(deps: PublicFormServiceDeps): string {
  return deps.createId?.() ?? crypto.randomUUID()
}

export const linkLimitsSchema = z.object({
  label: z
    .string()
    .trim()
    .max(80, "Keep the link's name to 80 characters.")
    .nullish()
    .transform((value) => value || null),
  expiresAt: z.iso.datetime({ local: true, offset: true, error: "Choose a valid expiry date." }).nullish(),
  maxSubmissions: z.number().int().positive("The submission limit must be a whole number above zero.").nullish(),
})

/**
 * A link for anyone, with its token when the app can derive it. A link made
 * before tokens were derived keeps working for whoever holds it, but its
 * token is kept only as a hash, so it cannot be shown again.
 */
export function withToken(row: unknown, deps: PublicFormServiceDeps): PublicFormLink {
  const link = parsePublicFormLinkRow(row)
  const token = (deps.linkToken ?? derivePublicLinkToken)(link.id)

  return { ...link, token: hashToken(token) === (row as { token_hash?: unknown }).token_hash ? token : "" }
}

export function runPublicLinkOperation<T>(
  operationName: string,
  input: TemplateAccessInput,
  operation: () => Promise<T>
): Promise<T> {
  const identifiers: Record<string, LogValue> = { actorUserId: input.actorUserId, organizationId: input.organizationId, templateId: input.templateId }
  return runOperation("public_form", toPublicFormServiceError, operationName, identifiers, operation)
}

function toPublicFormServiceError(error: unknown): PublicFormServiceError {
  if (error instanceof PublicFormServiceError) return error
  if (error instanceof TemplateServiceError) return new PublicFormServiceError(error.message, error.statusCode)
  return new PublicFormServiceError("Public form link service failed.", 500)
}
