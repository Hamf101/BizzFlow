import type { TemplateBranding } from "@/types/template"

/**
 * Which surface a generated document or template canvas is being drawn on.
 *
 * `screen` follows the interface theme. It is what an author edits against, so
 * it must stay legible in light and dark alike. `paper` reproduces the printed
 * page and applies the author's brand colours, which were chosen against paper
 * and are only trustworthy there.
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
 * Brand colours are absolute and were picked against a light page. Applying
 * them to a themed surface is what makes a document title vanish in dark mode,
 * so the screen surface uses theme tokens and leaves brand colour to paper and
 * to the finalized PDF.
 *
 * @param surface - Surface the document is drawn on.
 * @param branding - Author-chosen brand colours from the render plan.
 * @returns Primary and accent values for the surface's CSS variables.
 */
export function resolveDocumentSurfaceInk(
  surface: DocumentSurface,
  branding: TemplateBranding
): DocumentSurfaceInk {
  if (surface === "paper") {
    return { accent: branding.accentColor, primary: branding.primaryColor }
  }

  return { accent: "var(--primary)", primary: "var(--foreground)" }
}
