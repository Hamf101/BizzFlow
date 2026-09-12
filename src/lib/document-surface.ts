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
 * Measures brand ink against white paper in the exported PDF.
 *
 * Uses WCAG sRGB relative luminance; keep full precision when comparing a
 * threshold and round only the displayed ratio.
 * https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
 *
 * @param color - Six-digit hex color validated by the template branding schema.
 * @returns Contrast against white, from 1 (white) to 21 (black).
 */
export function getPaperContrastRatio(color: string): number {
  const linearChannels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  })
  const luminance =
    0.2126 * linearChannels[0] +
    0.7152 * linearChannels[1] +
    0.0722 * linearChannels[2]

  return 1.05 / (luminance + 0.05)
}

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
