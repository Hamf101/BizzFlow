import { MARGIN_SIZES, type TemplateLayout } from "@/types/template"

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
  modern: { density: "balanced", fieldStyle: "box", lineSpacing: undefined, marginPreset: "standard", margins: MARGIN_SIZES.normal, paragraphSpacing: undefined, sectionNumbers: undefined, sectionStyle: "plain" },
  // Answers on lines and numbered sections: agreements, letters, printed applications.
  classic: { density: "balanced", fieldStyle: "line", lineSpacing: undefined, marginPreset: "generous", margins: MARGIN_SIZES.normal, paragraphSpacing: undefined, sectionNumbers: "numbers", sectionStyle: "plain" },
  // Dense lettered sections under bars, answers in cells: government, medical and official forms.
  official: { density: "compact", fieldStyle: "cell", lineSpacing: 1.3, marginPreset: "compact", margins: MARGIN_SIZES.narrow, paragraphSpacing: 6, sectionNumbers: "letters", sectionStyle: "band" },
  // Tight spacing, boxed answers: checklists, logs and one-page forms.
  compact: { density: "compact", fieldStyle: "box", lineSpacing: 1.3, marginPreset: "compact", margins: MARGIN_SIZES.narrow, paragraphSpacing: 4, sectionNumbers: undefined, sectionStyle: "plain" },
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
  // Margins copied, so no page shares the style's own.
  return { ...layout, ...DOCUMENT_STYLES[style], margins: { ...DOCUMENT_STYLES[style].margins } }
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
      Object.entries(DOCUMENT_STYLES[style]).every(([key, value]) => sameSetting(drawn[key as keyof StyleSettings], value))
    ) ?? null
  )
}

// Settings are words and numbers, but margins are four of them.
function sameSetting(left: unknown, right: unknown): boolean {
  return typeof left === "object" && left !== null && typeof right === "object" && right !== null
    ? (["top", "right", "bottom", "left"] as const).every((side) => (left as Record<string, unknown>)[side] === (right as Record<string, unknown>)[side])
    : left === right
}
