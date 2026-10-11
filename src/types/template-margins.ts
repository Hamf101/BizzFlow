// Kept apart from template.ts and its schemas, so the page drawing them
// can read them without loading those.

/**
 * The margins offered by name, in points, as a word processor offers them:
 * half an inch all round, an inch, or an inch with two at the sides.
 */
export const MARGIN_SIZES = {
  narrow: { top: 36, right: 36, bottom: 36, left: 36 },
  normal: { top: 72, right: 72, bottom: 72, left: 72 },
  wide: { top: 72, right: 144, bottom: 72, left: 144 },
} as const satisfies Record<string, Readonly<Record<"top" | "right" | "bottom" | "left", number>>>

export type MarginSize = keyof typeof MARGIN_SIZES
