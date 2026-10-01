"use client"

import type { ComponentProps, ReactElement } from "react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { TextFieldBlock } from "@/types/template"

/**
 * A one-line answer as its field asks for it: the keys a phone shows for a
 * number, an email or a phone number, the words printed either side of it,
 * and one character a box when it is written in boxes.
 *
 * @param props - The field, and the input's own properties.
 * @returns The input, with its words beside it.
 */
export function TypedInput({ block, className, ...props }: ComponentProps<"input"> & { block: TextFieldBlock }): ReactElement {
  const input = (
    <Input
      {...props}
      {...typedInput(block.format)}
      className={cn(block.comb && "font-mono tracking-[0.5em]", block.comb && block.comb <= 20 && "w-auto", className)}
      maxLength={block.comb ?? props.maxLength ?? 20_000}
      size={block.comb}
    />
  )

  if (!block.prefix && !block.suffix) {
    return input
  }

  return (
    <div className="flex items-center gap-2">
      {block.prefix ? <span className="shrink-0 text-sm text-muted-foreground">{block.prefix}</span> : null}
      {input}
      {block.suffix ? <span className="shrink-0 text-sm text-muted-foreground">{block.suffix}</span> : null}
    </div>
  )
}

/**
 * How a typed answer is entered, so a phone shows the right keys and the
 * browser checks what it can.
 *
 * @param format - What the answer holds.
 * @returns The input's type and keyboard.
 */
export function typedInput(format: TextFieldBlock["format"]): { inputMode?: "decimal" | "email" | "tel"; type: string } {
  return (format && TYPED[format]) ?? { type: "text" }
}

const TYPED = {
  email: { inputMode: "email", type: "email" },
  money: { inputMode: "decimal", type: "text" },
  month: { type: "month" },
  number: { inputMode: "decimal", type: "text" },
  phone: { inputMode: "tel", type: "tel" },
  time: { type: "time" },
} as const
