import type { CSSProperties } from "react"

import type { PdfPage } from "@/services/pdf-signing-service"

/** A page's size as it shows: a page turned on its side swaps width and height. */
export function shownSize(page: PdfPage): { height: number; width: number } {
  return page.rotation === 90 || page.rotation === 270 ? { height: page.width, width: page.height } : page
}

/** A signer's tone, from the six in the theme; a seventh signer starts again. */
export function signerTone(index: number): CSSProperties {
  const tone = (Math.max(index, 0) % 6) + 1
  return { "--tone": `var(--signer-${tone})`, "--tone-soft": `var(--signer-${tone}-soft)` } as CSSProperties
}
