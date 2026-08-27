import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { createBlankTemplateContent } from "@/types/template"

/**
 * Record seeding for journeys that need a starting point rather than a subject.
 *
 * Template *content* is written directly rather than built through the block
 * editor. That is a deliberate boundary: the editor is the subject of Phase 3
 * (drag-to-reorder, slash menu, hover toolbar), and a spec that drove today's
 * markup would have to be rewritten by the work that is already planned. What
 * these specs do assert through the UI is everything downstream of the content —
 * publishing, filling, uploading, submitting, reviewing — which is the part a
 * pilot actually walks.
 */

export type SeededTemplate = {
  content: Record<string, unknown>
  fileFieldKey: string
  id: string
  textFieldKey: string
  title: string
}

/**
 * Inserts a template carrying one text field and one file field.
 *
 * @param client - Service-role client.
 * @param organizationId - Owning organization.
 * @param title - Template title, unique per run.
 * @param status - `draft` to publish through the UI, `published` to skip ahead.
 * @returns Handles for the template and its field keys.
 */
export async function seedTemplate(
  client: SupabaseClient,
  organizationId: string,
  title: string,
  status: "draft" | "published" = "draft"
): Promise<SeededTemplate> {
  const textFieldKey = "client_reference"
  const fileFieldKey = "supporting_document"

  // Built from the app's own blank content rather than a hand-written literal.
  // `document_templates_content_object` requires v3 content to carry exactly
  // schemaVersion, branding, blocks, layout, sections, fieldGroups and
  // blockRules — no more, no fewer — so a literal drifts into a constraint
  // violation the moment the schema gains a key.
  const content = {
    ...createBlankTemplateContent(),
    blocks: [
      {
        alignment: "left",
        id: randomUUID(),
        level: 2,
        text: "Supporting information",
        type: "heading",
      },
      {
        fieldKey: textFieldKey,
        helpText: null,
        id: randomUUID(),
        label: "Client reference",
        multiline: false,
        placeholder: null,
        required: true,
        type: "text_field",
      },
      {
        fieldKey: fileFieldKey,
        helpText: null,
        id: randomUUID(),
        label: "Supporting document",
        required: false,
        type: "file_field",
      },
    ],
  } as unknown as Record<string, unknown>

  const { data, error } = await client
    .from("document_templates")
    .insert({
      content,
      org_id: organizationId,
      status,
      title,
      ...(status === "published" ? { published_at: new Date().toISOString() } : {}),
    })
    .select("id")
    .single()

  if (error) {
    throw new Error(`Could not seed template: ${error.message}`)
  }

  return { content, fileFieldKey, id: data.id as string, textFieldKey, title }
}

/**
 * Inserts a submission already sitting at a chosen status.
 *
 * The review spec needs to start from `submitted` without re-walking the intake
 * journey that `submission-intake.spec.ts` already covers end to end.
 *
 * @param client - Service-role client.
 * @param organizationId - Owning organization.
 * @param template - Template the submission answers.
 * @param title - Submission title, unique per run.
 * @param authorUserId - Member recorded as author and submitter.
 * @param status - Starting status.
 * @returns The new submission id.
 */
export async function seedSubmission(
  client: SupabaseClient,
  organizationId: string,
  template: SeededTemplate,
  title: string,
  authorUserId: string,
  status: "draft" | "submitted" = "submitted"
): Promise<string> {
  const { data, error } = await client
    .from("submissions")
    .insert({
      created_by: authorUserId,
      org_id: organizationId,
      status,
      template_id: template.id,
      template_revision: 1,
      template_snapshot: template.content,
      title,
      updated_by: authorUserId,
      values: { [template.textFieldKey]: "REF-4417" },
      ...(status === "submitted"
        ? { submitted_at: new Date().toISOString(), submitted_by: authorUserId }
        : {}),
    })
    .select("id")
    .single()

  if (error) {
    throw new Error(`Could not seed submission: ${error.message}`)
  }

  return data.id as string
}

export type SeededSigningDocument = {
  documentId: string
  signingToken: string
}

/**
 * Inserts a generated document awaiting one signature, with a known token.
 *
 * The signing token cannot be read back: only its SHA-256 lands in
 * `document_signing_recipients.token_hash`, which is the right design and means
 * a test has to supply the plaintext rather than discover it. The hash is
 * computed exactly as `document-signing/token-security.ts` does.
 *
 * @param client - Service-role client.
 * @param organizationId - Owning organization.
 * @param template - Template the document was generated from.
 * @param title - Document title, unique per run.
 * @param createdByUserId - Member who owns the generated document.
 * @param signer - Recipient name and email.
 * @returns The document id and the plaintext signing token.
 */
export async function seedSigningDocument(
  client: SupabaseClient,
  organizationId: string,
  template: SeededTemplate,
  title: string,
  createdByUserId: string,
  signer: { email: string; name: string }
): Promise<SeededSigningDocument> {
  const { data: document, error: documentError } = await client
    .from("documents")
    .insert({
      created_by: createdByUserId,
      org_id: organizationId,
      source_kind: "generated",
      template_id: template.id,
      template_revision: 1,
      template_snapshot: template.content,
      title,
    })
    .select("id")
    .single()

  if (documentError) {
    throw new Error(`Could not seed document: ${documentError.message}`)
  }

  const documentId = document.id as string

  const { error: answersError } = await client.from("document_answers").insert({
    document_id: documentId,
    org_id: organizationId,
    values: { [template.textFieldKey]: "REF-4417" },
    workflow_status: "awaiting_signatures",
  })

  if (answersError) {
    throw new Error(`Could not seed document answers: ${answersError.message}`)
  }

  const signingToken = `e2e-sign-${randomUUID()}`
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000)

  const { error: recipientError } = await client
    .from("document_signing_recipients")
    .insert({
      document_id: documentId,
      email: signer.email.toLowerCase(),
      name: signer.name,
      org_id: organizationId,
      requires_signature: true,
      status: "pending",
      token_expires_at: expiresAt.toISOString(),
      token_hash: createHash("sha256").update(signingToken, "utf8").digest("hex"),
    })

  if (recipientError) {
    throw new Error(`Could not seed signer: ${recipientError.message}`)
  }

  return { documentId, signingToken }
}

/**
 * Inserts an active public form link with a known token.
 *
 * Unlike signing tokens, these are stored in plaintext, so the value is chosen
 * here and used directly in the URL.
 *
 * @param client - Service-role client.
 * @param organizationId - Owning organization.
 * @param templateId - Published template the form collects.
 * @returns The link token.
 */
export async function seedPublicFormLink(
  client: SupabaseClient,
  organizationId: string,
  templateId: string
): Promise<string> {
  const token = `e2eform${randomUUID().replace(/-/g, "")}`.slice(0, 60)

  const { error } = await client.from("public_form_links").insert({
    org_id: organizationId,
    status: "active",
    template_id: templateId,
    token,
  })

  if (error) {
    throw new Error(`Could not seed public form link: ${error.message}`)
  }

  return token
}
