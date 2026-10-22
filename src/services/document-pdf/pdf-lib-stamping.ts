import { degrees, EncryptedPDFError, PDFDocument, PDFName, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib"

import { normalizeRotation, placeOnPage, type PdfPageBox, type PdfPlacement } from "@/lib/pdf/field-geometry"
import type { PdfField } from "@/types/pdf-fields"

import { DocumentPdfServiceError } from "./errors"

/** What a signer gave for one field. */
export type StampValue =
  | Readonly<{ kind: "checked" }>
  | Readonly<{ dataUrl: string; kind: "drawing" }>
  | Readonly<{ kind: "text"; text: string }>

const INK = rgb(0.12, 0.11, 0.13)
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/

/**
 * Writes signers' values onto a copy of an uploaded PDF, each where its field
 * was placed and upright however its page turns. The copy keeps the upload's
 * pages and nothing else of the file: none of its metadata, scripts, actions,
 * links or form fields, whose values are first drawn into their pages. The
 * upload itself is never changed, and the same values always make the same file.
 *
 * @param input - The upload's bytes, its fields and values, the copy's title,
 *   and the fixed time its metadata carries.
 * @returns The stamped copy.
 * @throws DocumentPdfServiceError 400 when the upload is locked or unreadable.
 */
export async function stampUploadedPdf(input: Readonly<{
  fields: readonly PdfField[]
  metadataTimestamp: string
  source: Uint8Array
  title: string
  values: Readonly<Record<string, StampValue>>
}>): Promise<Uint8Array> {
  const source = await readUpload(input.source)
  const copy = await PDFDocument.create()
  const pages = await copy.copyPages(source, source.getPageIndices())

  for (const page of pages) {
    // ponytail: every annotation goes, links included; keep URI links if people miss them.
    page.node.delete(PDFName.of("Annots"))
    page.node.delete(PDFName.of("AA"))
    copy.addPage(page)
  }

  const font = await copy.embedFont(StandardFonts.Helvetica)

  for (const field of input.fields) {
    const value = input.values[field.id]
    const page = copy.getPages()[field.page - 1]

    if (value && page) {
      await drawValue(copy, page, font, placeOnPage(field, boxOf(page)), field, value)
    }
  }

  copy.setTitle(input.title)
  copy.setCreator("BizFlow Docs")
  copy.setProducer("BizFlow Docs")
  // pdf-lib moves the modification date as pages change, so the fixed time goes on last.
  copy.setCreationDate(new Date(input.metadataTimestamp))
  copy.setModificationDate(new Date(input.metadataTimestamp))

  return copy.save({ useObjectStreams: false })
}

async function readUpload(bytes: Uint8Array): Promise<PDFDocument> {
  let source: PDFDocument

  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (error: unknown) {
    throw new DocumentPdfServiceError(
      error instanceof EncryptedPDFError ? "This PDF is locked with a password." : "This PDF could not be read.",
      400
    )
  }

  try {
    // What was typed into the upload's own form stays, as part of its pages.
    source.getForm().flatten()
  } catch {
    throw new DocumentPdfServiceError("This PDF's form could not be read.", 400)
  }

  return source
}

function boxOf(page: PDFPage): PdfPageBox {
  const crop = page.getCropBox()

  return { ...crop, rotation: normalizeRotation(page.getRotation().angle) }
}

async function drawValue(
  copy: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  placed: PdfPlacement,
  field: PdfField,
  value: StampValue
): Promise<void> {
  // A point in the field, from its bottom left as shown, in the page's own space.
  const at = (across: number, up: number) => {
    const radians = (placed.rotate * Math.PI) / 180
    return {
      x: placed.origin.x + across * Math.cos(radians) - up * Math.sin(radians),
      y: placed.origin.y + across * Math.sin(radians) + up * Math.cos(radians),
    }
  }

  if (value.kind === "text") {
    const words = value.text.replace(/\s+/g, " ").trim()
    const size = fitSize(font, words, field.fontSize ?? placed.height * 0.62, placed.width - 4)
    const start = at(2, (placed.height - font.heightAtSize(size, { descender: false })) / 2)

    page.drawText(words, { color: INK, font, rotate: degrees(placed.rotate), size, ...start })
    return
  }

  if (value.kind === "checked") {
    const thickness = Math.max(1, Math.min(placed.width, placed.height) * 0.1)
    const [a, b, c] = [at(placed.width * 0.2, placed.height * 0.5), at(placed.width * 0.42, placed.height * 0.25), at(placed.width * 0.8, placed.height * 0.78)]

    page.drawLine({ color: INK, end: b, start: a, thickness })
    page.drawLine({ color: INK, end: c, start: b, thickness })
    return
  }

  const bytes = PNG_DATA_URL.exec(value.dataUrl)?.[1]

  if (!bytes) {
    throw new DocumentPdfServiceError("A drawing could not be read.", 400)
  }

  const image = await copy.embedPng(Buffer.from(bytes, "base64"))
  const scale = Math.min(placed.width / image.width, placed.height / image.height)

  page.drawImage(image, {
    height: image.height * scale,
    rotate: degrees(placed.rotate),
    width: image.width * scale,
    ...at(0, (placed.height - image.height * scale) / 2),
  })
}

// The largest size, up to the one asked for, at which the words fit across.
function fitSize(font: PDFFont, words: string, wanted: number, room: number): number {
  const size = Math.max(6, Math.min(wanted, 28))
  const width = font.widthOfTextAtSize(words, size)

  return width > room && width > 0 ? Math.max(4, (size * room) / width) : size
}
