import type { TemplateLayout } from "@/types/template"

/** What a document style sets; the rest of the page setup is left as it is. */
type StyleSettings = Pick<
  TemplateLayout,
  "density" | "fieldStyle" | "lineSpacing" | "marginPreset" | "margins" | "paragraphSpacing" | "sectionNumbers" | "sectionStyle"
>

/**
 * Looks a whole document takes at once, each suited to a kind of document.
 * Every style names every setting it controls, so moving between styles
 * leaves nothing of the last one behind; absent means the plain default.
 */
export const DOCUMENT_STYLES = {
  // Airy, boxed answers: intake forms, sign-ups and anything filled in on a screen.
  modern: { density: "balanced", fieldStyle: "box", lineSpacing: undefined, marginPreset: "standard", margins: undefined, paragraphSpacing: undefined, sectionNumbers: undefined, sectionStyle: "plain" },
  // Answers on lines and numbered sections: agreements, letters, printed applications.
  classic: { density: "balanced", fieldStyle: "line", lineSpacing: undefined, marginPreset: "generous", margins: undefined, paragraphSpacing: undefined, sectionNumbers: "numbers", sectionStyle: "plain" },
  // Dense lettered sections under bars, answers in cells: government, medical and official forms.
  official: { density: "compact", fieldStyle: "cell", lineSpacing: 1.3, marginPreset: "compact", margins: undefined, paragraphSpacing: 6, sectionNumbers: "letters", sectionStyle: "band" },
  // Tight spacing, boxed answers: checklists, logs and one-page forms.
  compact: { density: "compact", fieldStyle: "box", lineSpacing: 1.3, marginPreset: "compact", margins: undefined, paragraphSpacing: 4, sectionNumbers: undefined, sectionStyle: "plain" },
} as const satisfies Record<string, StyleSettings>

export type DocumentStyle = keyof typeof DOCUMENT_STYLES

/**
 * Puts a document in a style.
 *
 * @param layout - The page setup now.
 * @param style - The style to take.
 * @returns The page setup in that style.
 */
export function applyDocumentStyle(layout: TemplateLayout, style: DocumentStyle): TemplateLayout {
  return { ...layout, ...DOCUMENT_STYLES[style] }
}

/**
 * The style a document is in, when every setting a style controls matches one.
 *
 * @param layout - The page setup.
 * @returns The style, or null once anything has been changed by hand.
 */
export function documentStyleOf(layout: TemplateLayout): DocumentStyle | null {
  // "box" and "plain" are what an absent setting draws.
  const drawn = { ...layout, fieldStyle: layout.fieldStyle ?? "box", sectionStyle: layout.sectionStyle ?? "plain" }

  return (
    (Object.keys(DOCUMENT_STYLES) as DocumentStyle[]).find((style) =>
      Object.entries(DOCUMENT_STYLES[style]).every(([key, value]) => drawn[key as keyof StyleSettings] === value)
    ) ?? null
  )
}
