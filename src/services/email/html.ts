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
 * Both supported providers receive this complete document verbatim. The
 * EmailJS dashboard template injects it through `{{{message_html}}}`.
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
    '<body style="margin:0;padding:0;background-color:#f3f1ed;color:#252329;font-family:Arial,Helvetica,sans-serif;">',
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safeSubject}</div>`,
    '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background-color:#f3f1ed;">',
    '<tr><td align="center" style="padding:32px 16px;">',
    '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border:1px solid #c9c2bb;border-radius:12px;border-collapse:separate;background-color:#fffdfc;overflow:hidden;">',
    '<tr><td style="padding:24px 32px;border-bottom:1px solid #c9c2bb;background-color:#ece6f3;color:#635273;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;line-height:24px;">BizFlow Docs</td></tr>',
    `<tr><td style="padding:32px;">${input.contentHtml}</td></tr>`,
    '<tr><td style="padding:20px 32px;border-top:1px solid #c9c2bb;background-color:#ece6f3;color:#706a72;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;">Sent securely by BizFlow Docs. This is an automated notification.</td></tr>',
    "</table>",
    "</td></tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("")
}

/**
 * The body of an email that asks for one thing: a heading, a line on why, a
 * button, the link written out for when the button doesn't work, and a note.
 *
 * @param input - Plain text for each part, and the link the button opens.
 * @returns An escaped body fragment for {@link wrapEmailDocument}.
 */
export function createActionEmailHtml(input: {
  action: string
  body: string
  heading: string
  note: string
  url: string
}): string {
  const safeUrl = escapeHtml(input.url)

  return [
    `<h1 style="margin:0 0 16px;color:#252329;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:700;line-height:32px;">${escapeHtml(input.heading)}</h1>`,
    `<p style="margin:0 0 24px;color:#706a72;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;">${escapeHtml(input.body)}</p>`,
    '<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-collapse:separate;"><tr><td style="border-radius:8px;background-color:#635273;">',
    `<a href="${safeUrl}" target="_blank" style="display:inline-block;padding:12px 20px;color:#fffdfc;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:20px;text-decoration:none;">${escapeHtml(input.action)}</a>`,
    "</td></tr></table>",
    '<p style="margin:0 0 8px;color:#706a72;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">If the button does not work, copy and paste this link into your browser:</p>',
    `<p style="margin:0 0 24px;overflow-wrap:anywhere;word-break:break-word;"><a href="${safeUrl}" target="_blank" style="color:#635273;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;text-decoration:underline;">${safeUrl}</a></p>`,
    `<p style="margin:0;padding-top:20px;border-top:1px solid #c9c2bb;color:#706a72;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">${escapeHtml(input.note)}</p>`,
  ].join("")
}
