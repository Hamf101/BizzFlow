import type { TemplateBranding } from "@/types/template"

/**
 * Which surface a generated document or template canvas is being drawn on.
 *
 * `screen` follows the interface theme. It is what an author edits against, so
 * it must stay legible in light and dark alike. `paper` reproduces the printed
 * page. Both show the author's brand colours: paper exactly, the screen
 * exactly on a light page and turned over on a dark one.
 */
export type DocumentSurface = "screen" | "paper"

/** Resolved colour values for a surface, ready to bind to CSS variables. */
export type DocumentSurfaceInk = Readonly<{
  accent: string
  primary: string
}>

/**
 * Resolves the ink a document should be drawn with on one surface.
 *
 * Brand colours were picked against a light page. Paper takes them as they
 * are. The screen takes them through the theme's `--doc-ink-from` and
 * `--doc-ink-by`: a light page leaves a colour exact, and a dark page turns
 * its lightness over, so near-black ink reads as near-white and an ink too
 * pale to print well is just as faint on screen.
 *
 * @param surface - Surface the document is drawn on.
 * @param branding - Author-chosen brand colours from the render plan.
 * @returns Primary and accent values for the surface's CSS variables.
 */
export function resolveDocumentSurfaceInk(
  surface: DocumentSurface,
  branding: TemplateBranding
): DocumentSurfaceInk {
  const ink = (colour: string): string =>
    surface === "paper" ? colour : `oklch(from ${colour} calc(var(--doc-ink-from) + var(--doc-ink-by) * l) c h)`

  return { accent: ink(branding.accentColor), primary: ink(branding.primaryColor) }
}
