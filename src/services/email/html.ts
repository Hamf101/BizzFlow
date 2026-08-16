const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
}

/**
 * Escapes a plain string before interpolating it into email HTML.
 *
 * @param value - Untrusted text or URL value.
 * @returns HTML-safe text with special characters encoded.
 */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character: string): string => HTML_ENTITIES[character] ?? character
  )
}

/**
 * Wraps an email body fragment in the full branded HTML document.
 *
 * Resend sends the `html` body verbatim, so the application owns the complete
 * document (this markup previously lived in the EmailJS dashboard template).
 *
 * @param input - Email subject (used for the title and hidden preheader) and
 *   the already-escaped body fragment.
 * @returns A complete, standalone HTML email document.
 */
export function wrapEmailDocument(input: {
  subject: string
  contentHtml: string
}): string {
  const safeSubject = escapeHtml(input.subject)

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="x-apple-disable-message-reformatting" />',
    `<title>${safeSubject}</title>`,
    "</head>",
    '<body style="margin:0;padding:0;background-color:#f5f5f5;color:#171717;font-family:Arial,Helvetica,sans-serif;">',
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safeSubject}</div>`,
    '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background-color:#f5f5f5;">',
    '<tr><td align="center" style="padding:32px 16px;">',
    '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border:1px solid #e5e5e5;border-radius:12px;border-collapse:separate;background-color:#ffffff;overflow:hidden;">',
    '<tr><td style="padding:24px 32px;border-bottom:1px solid #e5e5e5;color:#171717;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;line-height:24px;">BizFlow Docs</td></tr>',
    `<tr><td style="padding:32px;">${input.contentHtml}</td></tr>`,
    '<tr><td style="padding:20px 32px;border-top:1px solid #e5e5e5;background-color:#fafafa;color:#737373;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;">Sent securely by BizFlow Docs. This is an automated notification.</td></tr>',
    "</table>",
    "</td></tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("")
}
