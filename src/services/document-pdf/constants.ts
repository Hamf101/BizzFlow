import { resolve } from "node:path"

export const MAX_DRAWING_DATA_URL_LENGTH = 2_800_000
export const DRAWING_DATA_URL_PATTERN =
  /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/
export const PAGE_FLOW_HEIGHT = 760
export const PARAGRAPH_CHUNK_CHARACTERS = 1_100
export const FIELD_CHUNK_CHARACTERS = 1_200
export const LIST_ENTRY_CHUNK_CHARACTERS = 900
export const LIST_CHUNK_HEIGHT = 250
export const TABLE_CHUNK_HEIGHT = 270
export const A4_WIDTH = 595.28
export const A4_HEIGHT = 841.89
export const PAGE_HORIZONTAL_MARGIN = 40
export const PAGE_TOP_MARGIN = 36
export const PAGE_BOTTOM_MARGIN = 20
export const PDF_CONTENT_WIDTH = A4_WIDTH - PAGE_HORIZONTAL_MARGIN * 2

const PDF_FONT_PACKAGE_DIRECTORY = resolve(
  process.cwd(),
  "node_modules",
  "dejavu-fonts-ttf",
  "ttf"
)

export const PDF_REGULAR_FONT_PATH = resolve(
  PDF_FONT_PACKAGE_DIRECTORY,
  "DejaVuSans.ttf"
)
export const PDF_BOLD_FONT_PATH = resolve(
  PDF_FONT_PACKAGE_DIRECTORY,
  "DejaVuSans-Bold.ttf"
)
