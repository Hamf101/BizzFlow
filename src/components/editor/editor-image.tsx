"use client"

import { type PointerEvent, type ReactElement, useRef } from "react"

import type { CanvasActions } from "@/components/editor/editor-block"
import { pageUnder, placeImage } from "@/components/editor/image-placement"
import { cn } from "@/lib/utils"
import type { TemplateBlock } from "@/types/template"
import { imageSource } from "@/types/template-images"

type ImageBlock = Extract<TemplateBlock, { type: "image" }>
type Drag = Readonly<{ block: ImageBlock; height: number; left: number; top: number; width: number; x: number; y: number }>

/**
 * A picture on the page. In line, it sits in the text and its corner sets its
 * width. Placed, it fills the box its block was given on a page, moves with
 * the pointer, even onto another page, and its corner sets its size.
 *
 * @param props - The picture, the canvas's actions, and whether it is placed.
 * @returns The picture.
 */
export function EditorImage({ actions, block, placed = false }: { actions: CanvasActions; block: ImageBlock; placed?: boolean }): ReactElement {
  const { controller } = actions
  const drag = useRef<Drag | null>(null)
  const editable = actions.textEditable
  const selected = editable && controller.selectedBlockId === block.id
  const source = imageSource(block.asset, block.dataUrl)
  // On a phone's reflowed column a placed picture keeps its width, near where it was.
  const flowStyle = block.placement
    ? { marginLeft: `${Math.min(block.placement.x, 100 - block.placement.width)}%`, width: `${block.placement.width}%` }
    : { width: `${block.widthPercent}%` }

  function start(event: PointerEvent<HTMLElement>): Drag | null {
    const box = event.currentTarget.closest<HTMLElement>("[data-image-box]")?.getBoundingClientRect()

    if (!editable || !box || event.button !== 0) {
      return null
    }

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    controller.select(block.id)

    return { block, height: box.height, left: box.left, top: box.top, width: box.width, x: event.clientX, y: event.clientY }
  }

  function move(event: PointerEvent<HTMLElement>): void {
    const from = drag.current
    const placement = from?.block.placement
    const page = from && placement ? pageUnder(event.currentTarget, event.clientY) : null

    if (!from || !placement || !page) {
      return
    }

    // The point grabbed stays under the pointer, on whichever page that is.
    const bounds = page.element.getBoundingClientRect()

    update({
      ...from.block,
      placement: placeImage({
        ...placement,
        page: page.number,
        x: ((event.clientX - (from.x - from.left) - bounds.left) / bounds.width) * 100,
        y: ((event.clientY - (from.y - from.top) - bounds.top) / bounds.height) * 100,
      }),
    })
  }

  function resize(event: PointerEvent<HTMLElement>): void {
    const from = drag.current

    if (!from) {
      return
    }

    const grown = event.clientX - from.x

    if (from.block.placement) {
      const page = pageUnder(event.currentTarget, from.top)?.element.getBoundingClientRect()

      if (page) {
        // A placed picture's box keeps its shape as it grows.
        const width = Math.max(8, from.width + grown)

        update({
          ...from.block,
          placement: placeImage({
            ...from.block.placement,
            height: ((width * from.height) / from.width / page.height) * 100,
            width: (width / page.width) * 100,
          }),
        })
      }
    } else {
      // A centred picture grows on both sides, so its corner moves half as fast.
      const column = from.width / (from.block.widthPercent / 100)
      const widthPercent = from.block.widthPercent + ((grown * (from.block.alignment === "center" ? 2 : 1)) / column) * 100

      update({ ...from.block, widthPercent: Math.round(Math.min(100, Math.max(10, widthPercent))) })
    }
  }

  function update(next: ImageBlock): void {
    controller.updateBlock(next, `image:${block.id}`)
  }

  function end(): void {
    drag.current = null
  }

  return (
    <div
      className={cn(
        "relative",
        placed && "size-full",
        !block.placement && block.alignment === "center" && "mx-auto",
        !block.placement && block.alignment === "right" && "ml-auto"
      )}
      data-image-box=""
      style={placed ? undefined : flowStyle}
    >
      <div
        className={cn("flex h-full flex-col", placed && editable && "cursor-move touch-none")}
        onPointerCancel={end}
        onPointerDown={(event) => {
          drag.current = placed ? start(event) : null
        }}
        onPointerMove={move}
        onPointerUp={end}
      >
        {source ? (
          // eslint-disable-next-line @next/next/no-img-element -- the author's own picture, already authorised
          <img
            alt={block.altText}
            className={cn("w-full object-contain", placed && "min-h-0 flex-1")}
            draggable={false}
            src={source}
          />
        ) : (
          <div aria-label={block.altText} className={cn("w-full bg-muted", placed ? "flex-1" : "aspect-video")} role="img" />
        )}
        {block.caption ? (
          <p className="shrink-0 text-center text-muted-foreground" style={{ fontSize: "calc(var(--doc-pt, 1.4px) * 8)", lineHeight: "calc(var(--doc-pt, 1.4px) * 14)" }}>
            {block.caption}
          </p>
        ) : null}
      </div>
      {/* On a phone's column a placed picture keeps its size. */}
      {selected && (placed || !block.placement) ? (
        <span
          aria-hidden="true"
          className="absolute -right-1.5 -bottom-1.5 size-3.5 cursor-nwse-resize touch-none rounded-[3px] border-2 border-primary bg-card"
          onPointerCancel={end}
          onPointerDown={(event) => {
            drag.current = start(event)
          }}
          onPointerMove={resize}
          onPointerUp={end}
        />
      ) : null}
    </div>
  )
}
