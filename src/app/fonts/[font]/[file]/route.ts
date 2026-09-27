import { NextResponse } from "next/server"

import { captureUnexpectedError } from "@/lib/observability"
import { DocumentFontError, getDocumentFontAsset } from "@/services/document-font-service"

type DocumentFontRouteContext = {
  params: Promise<{ file: string; font: string }>
}

/**
 * Serves a document font's stylesheet, licence or files from this site, so a
 * reader's browser never fetches them from a third party.
 *
 * @param _request - Public GET request.
 * @param context - The family and the file asked for.
 * @returns The asset, cached for a day in browsers and a year at the edge, or a JSON error.
 */
export async function GET(_request: Request, context: DocumentFontRouteContext): Promise<Response> {
  const { file, font } = await context.params

  try {
    const asset = await getDocumentFontAsset(font, file)

    return new Response(new Uint8Array(asset.body), {
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=31536000",
        "Content-Type": asset.contentType,
      },
    })
  } catch (error: unknown) {
    if (error instanceof DocumentFontError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }

    captureUnexpectedError(error, { routeName: "document_font" })
    return NextResponse.json({ error: "Unable to load this font." }, { status: 500 })
  }
}
