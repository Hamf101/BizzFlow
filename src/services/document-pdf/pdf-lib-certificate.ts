import { type PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib"

import { wrapPdfText } from "./pdf-lib-text"
import type { DocumentPdfSigner, NormalizedPdfInput } from "./types"

const INK = rgb(0.13, 0.13, 0.15)
const MUTED = rgb(0.42, 0.42, 0.45)

/**
 * Adds the signing certificate to a completed document: who signed, from
 * where, when, and that they agreed to sign electronically. Times are UTC, so
 * the page reads the same wherever it is printed.
 *
 * @param document - The PDF being written.
 * @param input - The completed document and its signers.
 * @param fonts - The document's regular and bold faces.
 * @param page - The page size and margin of the document's own pages.
 */
export function drawSigningCertificate(
  document: PDFDocument,
  input: Pick<NormalizedPdfInput, "documentId" | "signers" | "title">,
  fonts: { bold: PDFFont; regular: PDFFont },
  page: { height: number; margin: number; scale: number; width: number }
): void {
  const width = page.width - page.margin * 2
  const addPage = (): PDFPage => {
    const added = document.addPage([page.width, page.height])
    if (page.scale !== 1) {
      // Drawn at the design size, then printed on the paper, as the content pages are.
      added.scale(page.scale, page.scale)
    }
    return added
  }
  let certificate = addPage()
  let y = page.height - page.margin

  const write = (text: string, size: number, font: PDFFont, color = INK, gap = 4): void => {
    for (const line of wrapPdfText(text, font, size, width)) {
      y -= size * 1.35
      // A long list of signers carries on over as many pages as it needs.
      if (y < page.margin) {
        certificate = addPage()
        y = page.height - page.margin - size * 1.35
      }
      certificate.drawText(line, { color, font, size, x: page.margin, y })
    }
    y -= gap
  }

  write("Signing certificate", 18, fonts.bold, INK, 6)
  write(input.title, 11, fonts.regular, MUTED, 2)
  write(`Document ${input.documentId}`, 9, fonts.regular, MUTED, 14)

  for (const signer of input.signers) {
    write(signer.name, 12, fonts.bold, INK, 2)
    write(signerLines(signer).join("\n"), 10, fonts.regular, MUTED, 12)
  }

  write("Each signer opened a private link sent to the email address above and drew their signature on this document.", 9, fonts.regular, MUTED)
}

function signerLines(signer: DocumentPdfSigner): string[] {
  return [
    signer.email,
    signer.signedAt ? `Signed ${formatUtc(signer.signedAt)}` : signer.requiresSignature ? "Not signed" : "Not asked to sign",
    ...(signer.signedIp ? [`From ${signer.signedIp}`] : []),
    ...(signer.consentedAt ? [`Agreed to sign electronically ${formatUtc(signer.consentedAt)}`] : []),
  ]
}

function formatUtc(value: string): string {
  return `${new Date(value).toISOString().slice(0, 16).replace("T", " ")} UTC`
}
