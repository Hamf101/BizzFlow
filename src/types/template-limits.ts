// Kept apart from the template schemas so a page that only checks a picture,
// such as the one a signer opens, or only shows or fills a document, doesn't
// load every schema with it.

import type { BlockFrame, TemplateBlock, TextRun } from "@/types/template"

/** Maximum encoded length accepted for an embedded PNG or JPEG image. */
export const MAX_IMAGE_DATA_URL_LENGTH = 2_800_000

/** Canonical data URI pattern accepted for embedded PNG and JPEG images. */
export const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/

/**
 * Maximum number of ordered blocks accepted in one canonical document: room
 * for a 50-page agreement or handbook, at up to 50 blocks a page.
 */
export const MAX_TEMPLATE_BLOCK_COUNT = 2_500

/** The most rows one table holds; a long price list prints over several pages. */
export const MAX_TABLE_ROWS = 500

/** The most items one list holds. */
export const MAX_LIST_ITEMS = 500

/** One handwritten line of an answer box, in points. */
const ANSWER_BOX_LINE = 15
/** Room to sign in, in points. */
const ANSWER_BOX_SIGNATURE = 56

// How tall a field's answer box prints, in points, when its author has made it
// taller or shorter: never less than a written line and its padding (15 + 6 + 6),
// and it still grows to hold what is written in it.
export const BOX_HEIGHT_POINTS = { max: 600, min: 27 } as const

const RUN_MARKS = ["bold", "italic", "underline", "strike", "color", "highlight", "size", "link", "font"] as const

/**
 * Keeps formatting only while it spells out the text it formats. The text is
 * trimmed when saved, so its formatting is trimmed with it, while text being
 * typed keeps its spaces; neighbours that look alike are joined; and
 * formatting that no longer matches its text, as after an edit that rewrote
 * the words alone, or that marks nothing, is let go.
 *
 * @param text - The text, trimmed when saved or as typed while edited.
 * @param runs - Its formatting, as it arrived.
 * @returns The formatting to keep, or undefined when the text is plain.
 */
export function fitRuns(text: string, runs: readonly TextRun[] | null | undefined): TextRun[] | undefined {
  if (!runs?.length) {
    return undefined
  }

  const joined = runs.map((run: TextRun): string => run.text).join("")
  let skip = joined.startsWith(text) ? 0 : joined.length - joined.trimStart().length
  let keep = text.length
  const fitted: TextRun[] = []

  for (const run of runs) {
    const cut = Math.min(skip, run.text.length)
    const piece = run.text.slice(cut, cut + keep)
    const last = fitted.at(-1)
    skip -= cut
    keep -= piece.length

    if (!piece) {
      continue
    }

    if (last && RUN_MARKS.every((mark) => last[mark] === run[mark])) {
      last.text += piece
    } else {
      fitted.push({ ...run, text: piece })
    }
  }

  const marked = fitted.some((run: TextRun): boolean => RUN_MARKS.some((mark) => run[mark] !== undefined))

  return marked && fitted.map((run: TextRun): string => run.text).join("") === text ? fitted : undefined
}

/** The most blocks one row sets side by side. */
export const MAX_ROW_COLUMNS = 4

/**
 * Tells a block rule that changes anything, as one left at its defaults does not.
 *
 * @param rule - A block's rule.
 * @returns Whether it breaks a page, keeps with the next, adds space or moves the block across.
 */
export function ruleHasEffect(
  rule: Readonly<{ pageBreakBefore: boolean; keepWithNext: boolean; spaceAbove?: number; frame?: BlockFrame }>
): boolean {
  return rule.pageBreakBefore || rule.keepWithNext || (rule.spaceAbove ?? 0) > 0 || rule.frame !== undefined
}

/**
 * Tells a block pinned to a spot on its page, outside the flow of the rest.
 *
 * @param block - Canonical template block.
 * @returns Whether the block has a place of its own on a page.
 */
export function isPinnedBlock(block: TemplateBlock): boolean {
  return "placement" in block && block.placement !== undefined
}

/**
 * The least height of a field's answer box, in points, so a blank form leaves
 * room to write by hand: as its author made it, or else two lines for a short
 * answer, four for a long one, and room to sign.
 *
 * @param block - The field.
 * @returns The box's least height.
 */
export function answerBoxHeight(block: TemplateBlock): number {
  if ("boxHeight" in block && block.boxHeight !== undefined) {
    return block.boxHeight
  }

  if (block.type === "signature_field" || block.type === "initials_field") {
    return ANSWER_BOX_SIGNATURE
  }

  return block.type === "text_field" && block.multiline ? ANSWER_BOX_LINE * 4 : ANSWER_BOX_LINE * 2
}
