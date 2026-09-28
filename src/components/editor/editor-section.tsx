"use client"

import { FilePlus2, FoldVertical, Trash2 } from "lucide-react"
import { type ReactElement, useEffect, useRef } from "react"

import { EditableText } from "./editable-text"
import { sectionTitleKey } from "./editor-content"
import type { EditorController } from "./use-editor-controller"
import { Button } from "@/components/ui/button"
import type { TemplateSection } from "@/types/template"

/**
 * Edits a section title on the page and exposes its two pagination rules.
 * Empty drafts stay local until blur, preserving the last valid saved title.
 * @param props - The section and shared editor controller.
 * @returns The editable heading and its contextual toolbar.
 */
export function EditorSection({ controller, section }: { controller: EditorController; section: TemplateSection }): ReactElement {
  const key = sectionTitleKey(section.id)
  const host = useRef<HTMLDivElement>(null)
  const active = controller.activeBlockId === key
  const focus = controller.focus?.blockId === key ? controller.focus : null

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
          <Button aria-label="Remove section" className="size-10 md:pointer-fine:size-8" onClick={() => controller.removeSection(section.id)} size="icon-sm" title="Remove section, keep its content" type="button" variant="ghost"><Trash2 /></Button>
        </div>
      ) : null}
      <EditableText
        as="h2"
        caretKey={key}
        className="font-semibold"
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
        style={{ color: "var(--doc-primary)", fontSize: "1.5em", marginBottom: "0.5em" }}
        value={section.label}
      />
    </div>
  )
}
