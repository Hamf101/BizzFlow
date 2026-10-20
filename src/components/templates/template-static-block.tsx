import Image from "next/image"
import type { CSSProperties, ReactElement } from "react"

import { RichText } from "@/components/templates/rich-text"
import { cn } from "@/lib/utils"
import type { HeadingBlock, TemplateBlock } from "@/types/template"
import { imageSource } from "@/types/template-images"

type StaticTemplateBlock = Extract<
  TemplateBlock,
  {
    type:
      | "heading"
      | "paragraph"
      | "bullet_list"
      | "numbered_list"
      | "image"
      | "table"
      | "divider"
  }
>

type TemplateStaticBlockProps = {
  accentColorVariable: string
  block: StaticTemplateBlock
  /** A numbered list's markers from the render plan, such as "3.1" and "(a)". */
  listMarkers?: readonly string[] | null
  primaryColorVariable: string
}

type ListBlock = Extract<TemplateBlock, { type: "bullet_list" | "numbered_list" }>

// A bullet a level down is hollow, and below that square, as in a word processor.
const BULLETS = ["•", "◦", "▪"] as const

/**
 * What a list item is marked with: its number from the render plan, such as
 * "3.1" or "(a)", or a bullet for its level.
 *
 * @param block - The list.
 * @param index - The item.
 * @param markers - The render plan's markers for a numbered list.
 * @returns The marker.
 */
export function listItemMarker(block: ListBlock, index: number, markers?: readonly string[] | null): string {
  return block.type === "bullet_list" ? BULLETS[Math.min(block.levels?.[index] ?? 0, BULLETS.length - 1)]! : (markers?.[index] ?? `${index + 1}.`)
}

/**
 * How far a list item is set in, a level at a time.
 *
 * @param block - The list.
 * @param index - The item.
 * @returns Its left padding.
 */
export function listItemIndent(block: ListBlock, index: number): string | undefined {
  const level = block.levels?.[index] ?? 0

  return level ? `${level * 1.5}em` : undefined
}

/**
 * Checks whether a template block is presentation-only rather than an answer field.
 *
 * @param block - Canonical template block.
 * @returns True for heading, copy, image, table, list, and divider blocks.
 */
export function isStaticTemplateBlock(
  block: TemplateBlock
): block is StaticTemplateBlock {
  return (
    block.type === "heading" ||
    block.type === "paragraph" ||
    block.type === "bullet_list" ||
    block.type === "numbered_list" ||
    block.type === "image" ||
    block.type === "table" ||
    block.type === "divider"
  )
}

/**
 * Renders presentation-only template blocks consistently in previews and documents.
 *
 * @param props - Static block and the caller's branding CSS variables.
 * @returns Rendered static block.
 */
export function TemplateStaticBlock({
  accentColorVariable,
  block,
  listMarkers,
  primaryColorVariable,
}: TemplateStaticBlockProps): ReactElement | null {
  switch (block.type) {
    case "heading":
      return (
        <TemplateHeading
          block={block}
          primaryColorVariable={primaryColorVariable}
        />
      )
    case "paragraph":
      return (
        <p
          className="whitespace-pre-wrap text-sm leading-[var(--doc-line-height,1.5rem)]"
          style={{ textAlign: block.alignment }}
        >
          {block.text ? <RichText runs={block.runs} text={block.text} /> : "Paragraph"}
        </p>
      )
    case "bullet_list":
    case "numbered_list": {
      const List = block.type === "bullet_list" ? "ul" : "ol"

      // Marked by the plan, not the browser, so 3.1 and (a) read as the PDF prints them.
      return (
        <List className="grid list-none gap-1 text-sm leading-[var(--doc-line-height,1.5rem)]">
          {block.items.map((item: string, index: number) => (
            <li className="flex gap-2" key={`${block.id}-${index}`} style={{ paddingLeft: listItemIndent(block, index) }}>
              <span className="min-w-[1.25em] shrink-0 tabular-nums">{listItemMarker(block, index, listMarkers)}</span>
              <span className="min-w-0">
                <RichText runs={block.itemRuns?.[index]} text={item} />
              </span>
            </li>
          ))}
        </List>
      )
    }
    case "image": {
      // A picture placed on a page is drawn over it, not in the text.
      if (block.placement) {
        return null
      }

      const source = imageSource(block.asset, block.dataUrl)

      return (
        <figure
          className={cn(
            "flex flex-col gap-2",
            block.alignment === "left" && "items-start",
            block.alignment === "center" && "items-center",
            block.alignment === "right" && "items-end"
          )}
        >
          {source ? (
            <Image
              alt={block.altText}
              className="h-auto max-w-full rounded-sm object-contain"
              height={block.asset?.height ?? 600}
              src={source}
              style={{ width: `${block.widthPercent}%` }}
              unoptimized
              width={block.asset?.width ?? 800}
            />
          ) : (
            // A stored picture this page was not given an address for.
            <div
              aria-label={block.altText}
              className="aspect-video max-w-full rounded-sm bg-muted"
              role="img"
              style={{ width: `${block.widthPercent}%` }}
            />
          )}
          {block.caption && (
            <figcaption className="text-xs text-muted-foreground">
              {block.caption}
            </figcaption>
          )}
        </figure>
      )
    }
    case "table":
      return (
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-muted">
              <tr>
                {block.headers.map((header: string, index: number) => (
                  <th
                    className="border-b border-border px-3 py-2 font-semibold"
                    key={`${block.id}-header-${index}`}
                    scope="col"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row: string[], rowIndex: number) => (
                <tr key={`${block.id}-row-${rowIndex}`}>
                  {block.headers.map((_header: string, columnIndex: number) => (
                    <td
                      className="border-b border-border px-3 py-2"
                      key={`${block.id}-${rowIndex}-${columnIndex}`}
                    >
                      {row[columnIndex] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case "divider":
      return (
        <hr
          className="border-0 border-t"
          style={{ borderColor: accentColorVariable }}
        />
      )
  }
}

function TemplateHeading({
  block,
  primaryColorVariable,
}: {
  block: HeadingBlock
  primaryColorVariable: string
}): ReactElement {
  const className = cn(
    "font-semibold",
    block.level === 1 && "text-2xl",
    block.level === 2 && "text-xl",
    block.level === 3 && "text-base"
  )
  const style = {
    color: primaryColorVariable,
    textAlign: block.alignment,
  } as CSSProperties

  const text = <RichText runs={block.runs} text={block.text} />

  if (block.level === 1) {
    return <h1 className={className} style={style}>{text}</h1>
  }

  if (block.level === 2) {
    return <h2 className={className} style={style}>{text}</h2>
  }

  return <h3 className={className} style={style}>{text}</h3>
}
