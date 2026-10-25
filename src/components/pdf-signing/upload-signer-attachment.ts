const FALLBACK = "That file didn't upload. Try again."

// A message meant for the signer, as opposed to whatever the browser threw.
class AttachmentError extends Error {}

// The signing routes answer a refusal with a message written for the signer.
async function failure(response: Response): Promise<AttachmentError> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  return new AttachmentError(typeof body?.error === "string" && body.error ? body.error : FALLBACK)
}

/**
 * Uploads one signer's file for an attachment field: starts it, puts the bytes
 * at the create-only address, and confirms it.
 *
 * @param token - The signer's link token.
 * @param fieldId - The attachment field.
 * @param file - The chosen file.
 * @returns The stored attachment's id.
 * @throws Error carrying the server's reason (such as the file cap), or a generic retry message,
 *   never the browser's own text for a dropped connection.
 */
export async function uploadSignerAttachment(token: string, fieldId: string, file: File): Promise<string> {
  try {
    return await upload(token, fieldId, file)
  } catch (error: unknown) {
    throw error instanceof AttachmentError ? error : new AttachmentError(FALLBACK)
  }
}

async function upload(token: string, fieldId: string, file: File): Promise<string> {
  const base = `/api/sign/${encodeURIComponent(token)}/attachments`
  const json = { "Content-Type": "application/json" }
  const started = await fetch(base, {
    body: JSON.stringify({ byteSize: file.size, contentType: file.type, fieldId, filename: file.name }),
    headers: json,
    method: "POST",
  })
  if (!started.ok) throw await failure(started)

  const { attachmentId, uploadUrl } = (await started.json()) as { attachmentId: string; uploadUrl: string }
  // The upload address is create-only: it takes the file only with If-None-Match, as it was signed.
  const put = await fetch(uploadUrl, { body: file, headers: { "content-type": file.type, "if-none-match": "*" }, method: "PUT" })
  if (!put.ok) throw new AttachmentError(FALLBACK)

  const confirmed = await fetch(`${base}/${encodeURIComponent(attachmentId)}`, { headers: json, method: "POST" })
  if (!confirmed.ok) throw await failure(confirmed)

  return attachmentId
}
