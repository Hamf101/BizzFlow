"use client"

import { ArrowDown, ArrowUp, FilePlus2, FoldVertical, Trash2 } from "lucide-react"
import { type CSSProperties, type ReactElement, useEffect, useRef } from "react"

import { EditableText } from "./editable-text"
import { sectionTitleKey } from "./editor-content"
import type { EditorController } from "./use-editor-controller"
import { EDGE, PRINTED_HEADING, printedSpace, SECTION_TITLE } from "@/components/editor/paper-field"
import { Button } from "@/components/ui/button"
import {
  SECTION_BAR_LIGHT,
  SECTION_BOX_EDGE,
  SECTION_BOX_GAP,
  SECTION_BOX_INSET,
} from "@/services/templates/template-render-plan"
import type { TemplateLayout, TemplateSection } from "@/types/template"

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

function sectionTitleStyle(style: TemplateLayout["sectionStyle"]): CSSProperties {
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

/**
 * Edits a section title on the page and exposes its two pagination rules.
 * Empty drafts stay local until blur, preserving the last valid saved title.
 * The section's number shows beside the title, not in it.
 * @param props - The section, its number, and shared editor controller.
 * @returns The editable heading and its contextual toolbar.
 */
export function EditorSection({ controller, number, section }: { controller: EditorController; number: string | null; section: TemplateSection }): ReactElement {
  const key = sectionTitleKey(section.id)
  const host = useRef<HTMLDivElement>(null)
  const active = controller.activeBlockId === key
  const focus = controller.focus?.blockId === key ? controller.focus : null
  const place = controller.content.sections.findIndex((candidate) => candidate.id === section.id)

  useEffect(() => {
    const element = host.current?.querySelector<HTMLElement>("[contenteditable]")
    if (!element || !focus) return
    element.focus()
    const range = document.createRange()
    range.selectNodeContents(element)
    if (element.textContent !== "Section title") {
      range.setStart(element.firstChild ?? element, Math.min(focus.offset, element.textContent?.length ?? 0))
      range.collapse(true)
    }
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
  }, [focus])

  function focusBody(): void {
    const block = controller.content.blocks.find((candidate) => candidate.id === section.startBlockId)
    if (block?.type === "paragraph" || block?.type === "heading") {
      controller.requestFocus({ blockId: block.id, offset: 0 })
    } else if (block?.type === "bullet_list" || block?.type === "numbered_list") {
      controller.requestFocus({ blockId: block.id, item: 0, offset: 0 })
    } else {
      controller.select(section.startBlockId)
    }
  }

  return (
    <div className="relative" data-section-title={section.id} ref={host} onBlur={(event) => {
      if ((event.target as HTMLElement).isContentEditable || event.target.getAttribute("contenteditable")) {
        event.target.textContent = section.label
      }
    }}>
      {active ? (
        <div aria-label="Section" className="absolute right-0 bottom-full z-30 mb-2 flex max-w-full items-center gap-0.5 rounded-xl border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg" data-slot="section-toolbar" role="toolbar">
          <span className="px-2 text-xs">Section</span>
          {([
            ["pageBreakBefore", "Start on a new page", FilePlus2],
            ["keepTogether", "Keep on one page", FoldVertical],
          ] as const).map(([rule, label, Icon]) => (
            <Button aria-label={label} aria-pressed={section[rule]} className="size-10 aria-pressed:bg-secondary aria-pressed:text-secondary-foreground md:pointer-fine:size-8" key={rule} onClick={() => controller.updateSection(section.id, { [rule]: !section[rule] })} size="icon-sm" title={label} type="button" variant="ghost"><Icon /></Button>
          ))}
          <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
          {([
            ["up", "Move section up", ArrowUp, place <= 0],
            ["down", "Move section down", ArrowDown, place === controller.content.sections.length - 1],
          ] as const).map(([direction, label, Icon, disabled]) => (
            <Button aria-label={label} className="size-10 md:pointer-fine:size-8" disabled={disabled} key={direction} onClick={() => controller.moveSection(section.id, direction)} size="icon-sm" title={label} type="button" variant="ghost"><Icon /></Button>
          ))}
          <Button aria-label="Remove section" className="size-10 md:pointer-fine:size-8" onClick={() => controller.removeSection(section.id)} size="icon-sm" title="Remove section, keep its content" type="button" variant="ghost"><Trash2 /></Button>
        </div>
      ) : null}
      <div className="flex font-bold" style={sectionTitleStyle(controller.content.layout.sectionStyle)}>
      {number ? <span className="shrink-0 whitespace-pre">{`${number} `}</span> : null}
      <EditableText
        as="h2"
        caretKey={key}
        className="flex-1 font-bold"
        editable
        label="Section title"
        onChange={(text) => {
          const value = text.slice(0, 160)
          if (value.trim()) controller.updateSection(section.id, { label: value }, `section:${section.id}`)
        }}
        onFocus={() => { controller.select(null); controller.setActiveBlockId(key); controller.setLine(null) }}
        onKeyDown={(event, caret) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === "Enter" || (event.key === "ArrowDown" && caret.atEnd)) {
            event.preventDefault()
            focusBody()
          } else if (event.key === "Backspace" && caret.atStart && caret.collapsed) {
            event.preventDefault()
            controller.turnSectionInto(section.id, { type: "paragraph" })
          } else if (event.key === "ArrowUp" && caret.atStart) {
            const index = controller.content.blocks.findIndex((block) => block.id === section.startBlockId)
            const previous = controller.content.blocks[index - 1]
            if (previous) {
              event.preventDefault()
              if ("text" in previous) controller.requestFocus({ blockId: previous.id, offset: previous.text.length })
              else controller.select(previous.id)
            }
          }
        }}
        style={PRINTED_HEADING}
        value={section.label}
      />
      </div>
    </div>
  )
}
