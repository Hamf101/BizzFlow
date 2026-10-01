import { rgb, type PDFFont, type RGB } from "pdf-lib"

import { SECTION_BAR_LIGHT } from "@/services/templates/template-render-plan"

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

      // Only a word too long for a line is cut, a letter at a time.
      const wordParts = font.widthOfTextAtSize(word, size) <= maximumWidth ? [word] : splitPdfWord(word, font, size, maximumWidth)
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

/**
 * The colour words on a fill read in: white, or the page's ink on a fill too
 * light for white, judged by its OKLab lightness as the editor's CSS judges it.
 *
 * @param fill - A six-digit hex colour.
 * @returns White or the page's ink.
 */
export function readablePdfTextOn(fill: string): RGB {
  const [red, green, blue] = [1, 3, 5].map((at: number): number => {
    const channel = Number.parseInt(fill.slice(at, at + 2), 16) / 255

    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const lightness =
    0.2104542553 * Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue) +
    0.793617785 * Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue) -
    0.0040720468 * Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)

  return lightness > SECTION_BAR_LIGHT ? rgb(0.07, 0.09, 0.13) : rgb(1, 1, 1)
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
