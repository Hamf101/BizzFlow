import { PDFString, type PDFFont, type RGB } from "pdf-lib"

import type { TextRun } from "@/types/template"

import { hexToPdfColor, normalizeStandardFontText } from "./pdf-lib-text"
import type { PdfLibRenderContext } from "./pdf-lib-types"
import type { PdfTextAlignment } from "./types"

type Piece = { font: PDFFont; run: TextRun; size: number; text: string; width: number }
type Word = { pieces: Piece[]; width: number }

/**
 * Draws formatted text the way drawWrappedPdfText draws plain text: wrapped
 * to the width, aligned, a line at a time. Every word keeps the face, size and
 * colour of its run, and is underlined, struck through, highlighted or linked
 * as the run says; a line holding bigger words stands taller.
 *
 * @param context - Active pdf-lib render state.
 * @param runs - The text and its formatting.
 * @param topY - Top vertical coordinate.
 * @param x - Left content coordinate.
 * @param width - Available line width.
 * @param size - The block's own font size, for words without one.
 * @param lineHeight - Distance between lines of that size.
 * @param bold - Whether the block is bold throughout, as a heading is.
 * @param color - The block's own colour, for words without one.
 * @param alignment - Horizontal text alignment.
 * @returns The vertical coordinate immediately below the drawn lines.
 */
export async function drawRichPdfText(
  context: PdfLibRenderContext,
  runs: readonly TextRun[],
  topY: number,
  x: number,
  width: number,
  size: number,
  lineHeight: number,
  bold: boolean,
  color: RGB,
  alignment: PdfTextAlignment
): Promise<number> {
  const lines = wrap(await measure(context, runs, size, bold), width)
  let cursor = topY

  for (const line of lines) {
    const tallest = Math.max(size, ...line.flatMap((word: Word) => word.pieces.map((piece: Piece) => piece.size)))
    const used = line.reduce((total: number, word: Word, index: number) => total + word.width + (index > 0 ? space(line[index - 1]!) : 0), 0)
    const baseline = cursor - tallest
    // One clickable area for each stretch of a link on the line, spaces and all.
    const links: Array<{ bottom: number; left: number; right: number; top: number; url: string }> = []
    let penX = alignment === "center" ? x + (width - used) / 2 : alignment === "right" ? x + width - used : x

    line.forEach((word: Word, index: number): void => {
      const next = line[index + 1]?.pieces[0]

      for (const piece of word.pieces) {
        const { link } = piece.run
        const last = links.at(-1)
        // A run that carries on past the space underlines, strikes or highlights it too.
        const gap = piece === word.pieces.at(-1) && next?.run === piece.run ? space(word) : 0

        draw(context, piece, penX, baseline, color, gap)

        if (link && last?.url === link) {
          last.right = penX + piece.width
        } else if (link) {
          links.push({ bottom: baseline - piece.size * 0.25, left: penX, right: penX + piece.width, top: baseline + piece.size * 0.9, url: link })
        }

        penX += piece.width
      }

      penX += index < line.length - 1 ? space(word) : 0
    })

    for (const link of links) {
      const annotation = context.document.context.obj({
        A: { S: "URI", Type: "Action", URI: PDFString.of(link.url) },
        Border: [0, 0, 0],
        Rect: [link.left, link.bottom, link.right, link.top],
        Subtype: "Link",
        Type: "Annot",
      })
      context.page.node.addAnnot(context.document.context.register(annotation))
    }

    cursor -= lineHeight * (tallest / size)
  }

  return cursor
}

// Words as the runs spell them: whitespace ends a word, a change of run does not.
async function measure(context: PdfLibRenderContext, runs: readonly TextRun[], size: number, bold: boolean): Promise<Word[]> {
  const words: Word[] = []
  let pieces: Piece[] = []
  const finish = (): void => {
    if (pieces.length > 0) {
      words.push({ pieces, width: pieces.reduce((total: number, piece: Piece) => total + piece.width, 0) })
      pieces = []
    }
  }

  for (const run of runs) {
    const runSize = run.size ?? size

    for (const part of run.text.split(/(\s+)/)) {
      if (/^\s+$/.test(part)) {
        finish()
      } else if (part) {
        // A chosen family can lack a character, which then prints in the
        // default face; neighbours in the same face stay one piece.
        const groups: Array<{ font: PDFFont; text: string }> = []

        for (const character of part) {
          const font = await context.faceFor(bold || Boolean(run.bold), Boolean(run.italic), run.font, character)
          const last = groups.at(-1)

          if (last?.font === font) {
            last.text += character
          } else {
            groups.push({ font, text: character })
          }
        }

        for (const group of groups) {
          const text = normalizeStandardFontText(group.text, group.font)

          pieces.push({ font: group.font, run, size: runSize, text, width: group.font.widthOfTextAtSize(text, runSize) })
        }
      }
    }
  }

  finish()

  return words
}

function wrap(words: readonly Word[], width: number): Word[][] {
  const lines: Word[][] = []
  let line: Word[] = []
  let used = 0

  for (const whole of words) {
    // A word wider than a whole line breaks where the line runs out.
    for (const word of breakWord(whole, width)) {
      const gap = line.length > 0 ? space(line.at(-1)!) : 0

      if (line.length > 0 && used + gap + word.width > width) {
        lines.push(line)
        line = []
        used = 0
      }

      used += (line.length > 0 ? gap : 0) + word.width
      line.push(word)
    }
  }

  if (line.length > 0 || lines.length === 0) {
    lines.push(line)
  }

  return lines
}

function breakWord(word: Word, width: number): Word[] {
  if (word.width <= width) {
    return [word]
  }

  const parts: Word[] = []
  let pieces: Piece[] = []
  let used = 0

  for (const piece of word.pieces) {
    let text = ""

    for (const character of piece.text) {
      const extra = piece.font.widthOfTextAtSize(character, piece.size)

      if (used + extra > width && (used > 0 || text)) {
        if (text) pieces.push({ ...piece, text, width: piece.font.widthOfTextAtSize(text, piece.size) })
        parts.push({ pieces, width: used })
        pieces = []
        text = ""
        used = 0
      }

      text += character
      used += extra
    }

    if (text) pieces.push({ ...piece, text, width: piece.font.widthOfTextAtSize(text, piece.size) })
  }

  if (pieces.length > 0) {
    parts.push({ pieces, width: used })
  }

  return parts
}

function space(word: Word): number {
  const last = word.pieces.at(-1)

  return last ? last.font.widthOfTextAtSize(" ", last.size) : 0
}

function draw(context: PdfLibRenderContext, piece: Piece, x: number, baseline: number, color: RGB, gap: number): void {
  const { font, run, size, text } = piece
  const width = piece.width + gap
  const ink = run.color ? hexToPdfColor(run.color) : color
  const rule = (y: number): void =>
    context.page.drawLine({ color: ink, end: { x: x + width, y }, start: { x, y }, thickness: size * 0.06 })

  if (run.highlight) {
    context.page.drawRectangle({ color: hexToPdfColor(run.highlight), height: size * 1.12, width, x, y: baseline - size * 0.22 })
  }

  context.page.drawText(text, { color: ink, font, size, x, y: baseline })

  if (run.underline || run.link) rule(baseline - size * 0.12)
  if (run.strike) rule(baseline + size * 0.3)
}
