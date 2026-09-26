// fontkit ships no types of its own, and the PDF renderer only hands it to
// pdf-lib, which describes the engine it accepts.
declare module "fontkit" {
  export const create: Parameters<import("pdf-lib").PDFDocument["registerFontkit"]>[0]["create"]
}
