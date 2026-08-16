import Image from "next/image"
import type { CSSProperties, ReactElement } from "react"

import { cn } from "@/lib/utils"
import type { HeadingBlock, TemplateBlock } from "@/types/template"

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
  primaryColorVariable: string
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
  primaryColorVariable,
}: TemplateStaticBlockProps): ReactElement {
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
          className="whitespace-pre-wrap text-sm leading-6"
          style={{ textAlign: block.alignment }}
        >
          {block.text || "Paragraph"}
        </p>
      )
    case "bullet_list":
      return (
        <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
          {block.items.map((item: string, index: number) => (
            <li key={`${block.id}-${index}`}>{item}</li>
          ))}
        </ul>
      )
    case "numbered_list":
      return (
        <ol className="list-decimal space-y-1 pl-5 text-sm leading-6">
          {block.items.map((item: string, index: number) => (
            <li key={`${block.id}-${index}`}>{item}</li>
          ))}
        </ol>
      )
    case "image":
      return (
        <figure
          className={cn(
            "flex flex-col gap-2",
            block.alignment === "left" && "items-start",
            block.alignment === "center" && "items-center",
            block.alignment === "right" && "items-end"
          )}
        >
          <Image
            alt={block.altText}
            className="h-auto max-w-full rounded-sm object-contain"
            height={600}
            src={block.dataUrl}
            style={{ width: `${block.widthPercent}%` }}
            unoptimized
            width={800}
          />
          {block.caption && (
            <figcaption className="text-xs text-muted-foreground">
              {block.caption}
            </figcaption>
          )}
        </figure>
      )
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

  if (block.level === 1) {
    return <h1 className={className} style={style}>{block.text}</h1>
  }

  if (block.level === 2) {
    return <h2 className={className} style={style}>{block.text}</h2>
  }

  return <h3 className={className} style={style}>{block.text}</h3>
}
