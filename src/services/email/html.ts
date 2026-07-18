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
