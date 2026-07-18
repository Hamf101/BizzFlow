import { rgb } from "pdf-lib"

import {
  A4_WIDTH,
  PAGE_HORIZONTAL_MARGIN,
  PDF_CONTENT_WIDTH,
} from "./constants"
import { embedPdfLibImage, fitPdfImage } from "./pdf-lib-images"
import { normalizeStandardFontText } from "./pdf-lib-text"
import type { PdfLibRenderContext } from "./pdf-lib-types"
import {
  formatSignedAt,
  normalizeRequiredDrawingDataUrl,
} from "./shared"
import type { DocumentPdfSigner } from "./types"

/**
 * Draws the signing-record heading and workflow status.
 *
 * @param context - Active pdf-lib render state.
 * @param topY - Top vertical coordinate.
 * @returns The vertical coordinate below the signing introduction.
 */
export function drawPdfLibSigningIntro(
  context: PdfLibRenderContext,
  topY: number
): number {
  const lineY = topY - 10
  context.page.drawLine({
    start: { x: PAGE_HORIZONTAL_MARGIN, y: lineY },
    end: { x: A4_WIDTH - PAGE_HORIZONTAL_MARGIN, y: lineY },
    color: rgb(0.82, 0.84, 0.87),
    thickness: 0.8,
  })
  context.page.drawText("Signing record", {
    x: PAGE_HORIZONTAL_MARGIN,
    y: lineY - 24,
    color: rgb(0.07, 0.09, 0.13),
    font: context.boldFont,
    size: 14,
  })
  context.page.drawText(
    context.workflowStatus === "completed"
      ? "All parties have signed."
      : "Waiting for all required parties to sign.",
    {
      x: PAGE_HORIZONTAL_MARGIN,
      y: lineY - 40,
      color: rgb(0.29, 0.33, 0.39),
      font: context.regularFont,
      size: 9,
    }
  )

  return topY - 52
}

/**
 * Draws one signer status card and any captured signature or initials.
 *
 * @param context - Active pdf-lib render state.
 * @param signer - Canonical signer record.
 * @param topY - Top vertical coordinate.
 * @returns The vertical coordinate below the signer card.
 */
export async function drawPdfLibSigner(
  context: PdfLibRenderContext,
  signer: DocumentPdfSigner,
  topY: number
): Promise<number> {
  const hasDrawings = Boolean(
    signer.signatureDataUrl || signer.initialsDataUrl
  )
  const boxHeight = hasDrawings ? 68 : 54
  const boxBottom = topY - boxHeight

  context.page.drawRectangle({
    x: PAGE_HORIZONTAL_MARGIN,
    y: boxBottom,
    width: PDF_CONTENT_WIDTH,
    height: boxHeight,
    borderColor: rgb(0.9, 0.91, 0.93),
    borderWidth: 0.8,
  })
  context.page.drawText(
    normalizeStandardFontText(signer.name, context.boldFont),
    {
      x: PAGE_HORIZONTAL_MARGIN + 7,
      y: topY - 17,
      color: rgb(0.07, 0.09, 0.13),
      font: context.boldFont,
      size: 10,
    }
  )
  context.page.drawText(
    normalizeStandardFontText(signer.email, context.regularFont),
    {
      x: PAGE_HORIZONTAL_MARGIN + 7,
      y: topY - 31,
      color: rgb(0.29, 0.33, 0.39),
      font: context.regularFont,
      size: 8,
    }
  )
  context.page.drawText(
    normalizeStandardFontText(
      signer.status === "signed" && signer.signedAt
        ? `Signed ${formatSignedAt(signer.signedAt)}`
        : signer.requiresSignature
          ? "Signature pending"
          : "Signature not required",
      context.regularFont
    ),
    {
      x: PAGE_HORIZONTAL_MARGIN + 7,
      y: topY - 44,
      color: rgb(0.29, 0.33, 0.39),
      font: context.regularFont,
      size: 8,
    }
  )

  let drawingRight = A4_WIDTH - PAGE_HORIZONTAL_MARGIN - 7

  if (signer.initialsDataUrl) {
    const initials = await embedPdfLibImage(
      context,
      normalizeRequiredDrawingDataUrl(signer.initialsDataUrl)
    )
    const size = fitPdfImage(initials, 48, 26)
    const x = drawingRight - size.width
    context.page.drawText("Initials", {
      x,
      y: topY - 12,
      color: rgb(0.42, 0.45, 0.5),
      font: context.regularFont,
      size: 6,
    })
    context.page.drawImage(initials, {
      x,
      y: topY - 18 - size.height,
      height: size.height,
      width: size.width,
    })
    drawingRight = x - 10
  }

  if (signer.signatureDataUrl) {
    const signature = await embedPdfLibImage(
      context,
      normalizeRequiredDrawingDataUrl(signer.signatureDataUrl)
    )
    const size = fitPdfImage(signature, 88, 26)
    const x = drawingRight - size.width
    context.page.drawText("Signature", {
      x,
      y: topY - 12,
      color: rgb(0.42, 0.45, 0.5),
      font: context.regularFont,
      size: 6,
    })
    context.page.drawImage(signature, {
      x,
      y: topY - 18 - size.height,
      height: size.height,
      width: size.width,
    })
  }

  return boxBottom - 6
}
