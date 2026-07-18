import { rgb, type PDFFont, type RGB } from "pdf-lib"

import type { PdfLibRenderContext } from "./pdf-lib-types"
import type { PdfTextAlignment } from "./types"

/**
 * Draws wrapped and aligned text onto the active PDF page.
 *
 * @param context - Active pdf-lib render state.
 * @param value - Text to render.
 * @param topY - Top vertical coordinate.
 * @param x - Left content coordinate.
 * @param width - Available line width.
 * @param size - Font size.
 * @param lineHeight - Vertical distance between lines.
 * @param font - Embedded font used to measure and draw text.
 * @param color - Text color.
 * @param alignment - Horizontal text alignment.
 * @returns The vertical coordinate immediately below the rendered lines.
 */
export function drawWrappedPdfText(
  context: PdfLibRenderContext,
  value: string,
  topY: number,
  x: number,
  width: number,
  size: number,
  lineHeight: number,
  font: PDFFont,
  color: RGB,
  alignment: PdfTextAlignment
): number {
  const lines = wrapPdfText(value, font, size, width)

  lines.forEach((line: string, index: number): void => {
    const lineWidth = font.widthOfTextAtSize(line, size)
    const lineX =
      alignment === "center"
        ? x + (width - lineWidth) / 2
        : alignment === "right"
          ? x + width - lineWidth
          : x

    context.page.drawText(line, {
      x: lineX,
      y: topY - size - index * lineHeight,
      color,
      font,
      size,
    })
  })

  return topY - lines.length * lineHeight
}

/**
 * Wraps text to a measured PDF font width, splitting overlong words safely.
 *
 * @param value - Text to wrap.
 * @param font - Embedded font used for measurement.
 * @param size - Font size.
 * @param maximumWidth - Maximum line width.
 * @returns Ordered printable lines.
 */
export function wrapPdfText(
  value: string,
  font: PDFFont,
  size: number,
  maximumWidth: number
): string[] {
  const safeValue = normalizeStandardFontText(value, font).trim()

  if (safeValue.length === 0) {
    return [""]
  }

  const lines: string[] = []

  for (const paragraph of safeValue.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/)
    let currentLine = ""

    for (const word of words) {
      const candidate = currentLine.length > 0 ? `${currentLine} ${word}` : word

      if (font.widthOfTextAtSize(candidate, size) <= maximumWidth) {
        currentLine = candidate
        continue
      }

      if (currentLine.length > 0) {
        lines.push(currentLine)
        currentLine = ""
      }

      const wordParts = splitPdfWord(word, font, size, maximumWidth)
      lines.push(...wordParts.slice(0, -1))
      currentLine = wordParts.at(-1) ?? ""
    }

    if (currentLine.length > 0) {
      lines.push(currentLine)
    }
  }

  return lines.length > 0 ? lines : [""]
}

/**
 * Replaces glyphs unsupported by an embedded PDF font.
 *
 * @param value - Source text.
 * @param font - Embedded font used for validation.
 * @returns Font-safe text.
 */
export function normalizeStandardFontText(
  value: string,
  font: PDFFont
): string {
  try {
    font.encodeText(value)
    return value
  } catch {
    return Array.from(value)
      .map((character: string): string => {
        try {
          font.encodeText(character)
          return character
        } catch {
          return "?"
        }
      })
      .join("")
  }
}

/**
 * Converts a validated six-digit hex color to pdf-lib RGB values.
 *
 * @param value - Hex color string.
 * @returns pdf-lib RGB color.
 */
export function hexToPdfColor(value: string): RGB {
  return rgb(
    Number.parseInt(value.slice(1, 3), 16) / 255,
    Number.parseInt(value.slice(3, 5), 16) / 255,
    Number.parseInt(value.slice(5, 7), 16) / 255
  )
}

function splitPdfWord(
  word: string,
  font: PDFFont,
  size: number,
  maximumWidth: number
): string[] {
  const parts: string[] = []
  let currentPart = ""

  for (const character of word) {
    const candidate = `${currentPart}${character}`

    if (
      currentPart.length > 0 &&
      font.widthOfTextAtSize(candidate, size) > maximumWidth
    ) {
      parts.push(currentPart)
      currentPart = character
    } else {
      currentPart = candidate
    }
  }

  if (currentPart.length > 0) {
    parts.push(currentPart)
  }

  return parts.length > 0 ? parts : [""]
}
