import { readFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

// Written by scripts/update-document-fonts.mjs from Fontsource's copy of Google Fonts.
const FACES_PATH = path.join(process.cwd(), "public/fonts/faces.json")
const DEJAVU_DIRECTORY = path.join(process.cwd(), "node_modules/dejavu-fonts-ttf/ttf")
const FONT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_FONT_BYTES = 8_000_000

const fontSchema = z.object({
  license: z.string(),
  styles: z.array(z.enum(["italic", "normal"])).min(1),
  // Each subset's index into the shared unicode ranges.
  subsets: z.record(z.string().regex(/^[a-z0-9-]+$/), z.number().int().nonnegative()),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  weights: z.array(z.number().int().min(1).max(1000)).min(1),
})
const facesSchema = z.object({ fonts: z.record(z.string(), fontSchema), ranges: z.array(z.string()) })

type Faces = z.infer<typeof facesSchema>
type Font = z.infer<typeof fontSchema>
type Face = Readonly<{ style: "italic" | "normal"; weight: number }>

// The default family is DejaVu Sans, the faces the PDF has always printed in.
const DEFAULT_FILES = {
  "bold-italic.ttf": "DejaVuSans-BoldOblique.ttf",
  "bold.ttf": "DejaVuSans-Bold.ttf",
  "italic.ttf": "DejaVuSans-Oblique.ttf",
  "regular.ttf": "DejaVuSans.ttf",
} as const

let faces: Promise<Faces> | undefined
const spans = new Map<number, Array<readonly [number, number]>>()

/** A font asset that cannot be served, with the HTTP status that says why. */
export class DocumentFontError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "DocumentFontError"
    this.statusCode = statusCode
  }
}

/**
 * Finds the file that prints one character in a family: the face CSS would
 * choose for text this bold and this slanted, and the slice of the family
 * that holds the character.
 *
 * @param id - The family, as a document names it.
 * @param bold - Whether the text is bold.
 * @param italic - Whether the text is italic.
 * @param character - The character to print.
 * @returns The file, or null when the family is unknown or lacks the character.
 */
export async function resolveDocumentFont(
  id: string,
  bold: boolean,
  italic: boolean,
  character: string
): Promise<{ file: string } | null> {
  const catalog = await loadFaces()
  const font = FONT_ID_PATTERN.test(id) ? catalog.fonts[id] : undefined

  if (!font) {
    return null
  }

  const code = character.codePointAt(0) ?? 32
  const subset = Object.keys(font.subsets).find((name) => covers(catalog, font.subsets[name]!, code))

  return subset ? { file: fileName(subset, pickFace(font, bold, italic)) } : null
}

/**
 * Serves a family's stylesheet, licence or one of its files from this site, so
 * no reader's browser is sent to a third party. Only the faces a document can
 * show are offered, which keeps the stylesheet small and the screen and the
 * PDF on the same files.
 *
 * @param id - The family, as a document names it, or "default".
 * @param file - "font.css", "license.txt" or a face's file.
 * @param fetcher - Fetches the pinned file from Fontsource's CDN.
 * @returns The bytes and their content type.
 * @throws DocumentFontError when the asset does not exist or cannot be fetched.
 */
export async function getDocumentFontAsset(
  id: string,
  file: string,
  fetcher: typeof fetch = fetch
): Promise<{ body: Buffer; contentType: string }> {
  if (id === "default") {
    return getDefaultFontAsset(file)
  }

  const catalog = await loadFaces()
  const font = FONT_ID_PATTERN.test(id) ? catalog.fonts[id] : undefined

  if (!font) {
    throw new DocumentFontError("Font not found.", 404)
  }

  const shown = shownFaces(font)

  if (file === "font.css") {
    const rules = shown.flatMap((face) =>
      Object.entries(font.subsets).map(
        ([subset, range]) =>
          `@font-face{font-family:"bf-${id}";font-style:${face.style};font-weight:${face.weight};font-display:swap;` +
          `src:url("/fonts/${id}/${fileName(subset, face)}") format("woff2");unicode-range:${catalog.ranges[range]};}`
      )
    )

    return { body: Buffer.from(`/* ${font.license}: /fonts/${id}/license.txt */\n${rules.join("\n")}`), contentType: "text/css; charset=utf-8" }
  }

  const served = file === "license.txt" || shown.some((face) => Object.keys(font.subsets).some((subset) => fileName(subset, face) === file))

  if (!served) {
    throw new DocumentFontError("Font file not found.", 404)
  }

  const url =
    file === "license.txt"
      ? `https://cdn.jsdelivr.net/npm/@fontsource/${id}@${font.version}/LICENSE`
      : `https://cdn.jsdelivr.net/fontsource/fonts/${id}@${font.version}/${file}`

  try {
    const response = await fetcher(url, { cache: "force-cache", redirect: "error", signal: AbortSignal.timeout(15_000) })
    const body = response.ok ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0)

    if (body.length === 0 || body.length > MAX_FONT_BYTES) {
      throw new Error(`Fontsource answered ${response.status} with ${body.length} bytes`)
    }

    return { body, contentType: file === "license.txt" ? "text/plain; charset=utf-8" : "font/woff2" }
  } catch (error) {
    console.warn("document_font_unavailable", { file, fontId: id, reason: error instanceof Error ? error.message : "unknown" })
    throw new DocumentFontError("This font is unavailable right now. Please try again.", 502)
  }
}

async function getDefaultFontAsset(file: string): Promise<{ body: Buffer; contentType: string }> {
  if (file === "font.css") {
    const rules = Object.keys(DEFAULT_FILES).map(
      (face) =>
        `@font-face{font-family:"bf-default";font-style:${face.includes("italic") ? "italic" : "normal"};` +
        `font-weight:${face.startsWith("bold") ? 700 : 400};font-display:swap;src:url("/fonts/default/${face}") format("truetype");}`
    )

    return { body: Buffer.from(rules.join("\n")), contentType: "text/css; charset=utf-8" }
  }

  if (!Object.hasOwn(DEFAULT_FILES, file)) {
    throw new DocumentFontError("Font file not found.", 404)
  }

  return {
    body: await readFile(path.join(DEJAVU_DIRECTORY, DEFAULT_FILES[file as keyof typeof DEFAULT_FILES])),
    contentType: "font/ttf",
  }
}

function loadFaces(): Promise<Faces> {
  faces ??= readFile(FACES_PATH, "utf8")
    .then((json) => facesSchema.parse(JSON.parse(json)))
    .catch((error: unknown) => {
      faces = undefined
      throw error
    })

  return faces
}

// The faces a document shows: regular, bold, italic and bold italic, each as
// the nearest the family has.
function shownFaces(font: Font): Face[] {
  const picked = [false, true].flatMap((bold) => [false, true].map((italic) => pickFace(font, bold, italic)))

  return picked.filter((face, index) => picked.findIndex((other) => other.weight === face.weight && other.style === face.style) === index)
}

// The face CSS picks (CSS Fonts 4, §5.2): the style first, then the weight,
// trying heavier weights first for bold and 400 then 500 for regular text.
function pickFace(font: Font, bold: boolean, italic: boolean): Face {
  const style = font.styles.includes(italic ? "italic" : "normal") ? (italic ? "italic" : "normal") : font.styles[0]!
  const wanted = bold ? 700 : 400
  const heavier = font.weights.filter((weight) => weight >= wanted).sort((a, b) => a - b)
  const lighter = font.weights.filter((weight) => weight < wanted).sort((a, b) => b - a)
  const order = bold
    ? [...heavier, ...lighter]
    : [...heavier.filter((weight) => weight <= 500), ...lighter, ...heavier.filter((weight) => weight > 500)]

  return { style, weight: order[0]! }
}

function fileName(subset: string, face: Face): string {
  return `${subset}-${face.weight}-${face.style}.woff2`
}

// Whether a unicode-range, such as "U+0000-00FF,U+0131", holds a code point.
function covers(catalog: Faces, range: number, code: number): boolean {
  let parsed = spans.get(range)

  if (!parsed) {
    parsed = (catalog.ranges[range] ?? "").split(",").map((part) => {
      const [start = "", end = start] = part.trim().replace(/^U\+/i, "").split("-")

      return [parseInt(start, 16), parseInt(end, 16)] as const
    })
    spans.set(range, parsed)
  }

  return parsed.some(([start, end]) => code >= start && code <= end)
}
