import type { CSSProperties, ReactElement } from "react"

import { EDGE } from "@/components/editor/paper-answer-kinds"
import { PRINTED_HEADING, printedSpace, SECTION_TITLE } from "@/components/editor/paper-field"
import {
  SECTION_BAR_LIGHT,
  SECTION_BOX_EDGE,
  SECTION_BOX_GAP,
  SECTION_BOX_INSET,
} from "@/services/templates/template-render-plan"
import type { TemplateLayout } from "@/types/template"

/**
 * A section's title in a bar, as it prints: bold 11 points on 15 in a bar of
 * the primary colour, padded 5 points above and below and 6 at the ends, 8
 * points under it. Its words are white, or the page's ink on a bar too light
 * for white, judged as the PDF judges it; on a dark screen the bar turns over
 * with the page's ink, and its words follow.
 */
const SECTION_BAR: CSSProperties = {
  ...PRINTED_HEADING,
  backgroundColor: "var(--doc-primary)",
  color: `rgb(from oklch(from var(--doc-primary) clamp(0, (l - ${SECTION_BAR_LIGHT}) * 1000000, 1) 0 0) calc(255 - r * 0.93) calc(255 - g * 0.91) calc(255 - b * 0.87))`,
  fontSize: "1.1em",
  lineHeight: 15 / 11,
  marginBottom: printedSpace(8),
  padding: "calc(5 * var(--doc-pt)) calc(6 * var(--doc-pt))",
}

export function sectionTitleStyle(style: TemplateLayout["sectionStyle"]): CSSProperties {
  return style === "band" ? SECTION_BAR : SECTION_TITLE
}

/**
 * A section's title where it cannot be edited, with its number, as it prints.
 *
 * @param props - The title, its number, and how the layout prints titles.
 * @returns The title.
 */
export function PrintedSectionTitle({ label, number, sectionStyle }: { label: string; number: string | null; sectionStyle: TemplateLayout["sectionStyle"] }): ReactElement {
  return (
    <p className="font-bold" style={sectionTitleStyle(sectionStyle)}>
      {number ? `${number} ` : null}
      {label}
    </p>
  )
}

/**
 * Where a piece of a boxed section sits in its box, as the PDF draws it: an
 * edge and 8 points in from each side, the box's top edge and 8 points over
 * it where it opens, below any space asked for above, and 8 points and the
 * foot edge under it where it closes, then 10 points of space. Where a page
 * breaks the box, the piece above ends and the next begins without an edge.
 *
 * @param box - Whether the piece opens the box, closes it, or both.
 * @param space - The space above the piece, in CSS pixels.
 * @param point - CSS pixels in a point.
 * @returns The piece's padding and the box's edges, drawn behind it.
 */
export function sectionBoxStyle(box: Readonly<{ closes: boolean; opens: boolean }>, space: number, point: number): CSSProperties {
  const inset = SECTION_BOX_INSET * point
  const edge = SECTION_BOX_EDGE * point
  // Space above the piece that opens the box sits over the box, not in it.
  const top = box.opens ? space : 0
  const gap = box.closes ? SECTION_BOX_GAP * point : 0
  const line = `linear-gradient(${EDGE}, ${EDGE})`
  const side = `top ${top}px / ${edge}px calc(100% - ${top + gap}px) no-repeat`

  return {
    // Read by the canvas's rule for the room under a piece, so cells keep theirs inside the box.
    "--box-foot": `${box.closes ? inset + gap : 0}px`,
    background: [
      `${line} left 0 ${side}`,
      `${line} right 0 ${side}`,
      ...(box.opens ? [`${line} left 0 top ${top}px / 100% ${edge}px no-repeat`] : []),
      ...(box.closes ? [`${line} left 0 bottom ${gap}px / 100% ${edge}px no-repeat`] : []),
    ].join(", "),
    paddingLeft: inset,
    paddingRight: inset,
    paddingTop: space + (box.opens ? inset : 0),
  } as CSSProperties
}
