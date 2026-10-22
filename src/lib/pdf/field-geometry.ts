import { clamp } from "@/lib/utils"

/**
 * Where a field sits on a page as people see it: fractions of the shown
 * page's width and height, measured from its top left. Zoom, screen density
 * and page size never change them.
 */
export type PageFraction = Readonly<{ height: number; width: number; x: number; y: number }>

/** A page as its PDF describes it: the box it shows, in points, and how far it turns when shown. */
export type PdfPageBox = Readonly<{ height: number; rotation: 0 | 90 | 180 | 270; width: number; x: number; y: number }>

/** Where to draw in the PDF's own space so something lands, upright, where it was placed. */
export type PdfPlacement = Readonly<{
  height: number
  /** What shows as the field's bottom left. */
  origin: Readonly<{ x: number; y: number }>
  /** How far to turn what is drawn, anticlockwise, so it reads upright. */
  rotate: 0 | 90 | 180 | 270
  width: number
}>

/**
 * A page's rotation as viewers apply it: to the nearest quarter turn,
 * clockwise, whatever the file wrote.
 *
 * @param degrees - The page's /Rotate.
 * @returns 0, 90, 180 or 270.
 */
export function normalizeRotation(degrees: number): PdfPageBox["rotation"] {
  const quarter = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360

  return quarter as PdfPageBox["rotation"]
}

/**
 * The page's size as shown: a quarter turn swaps its width and height.
 *
 * @param page - The page.
 * @returns Its shown width and height, in points.
 */
export function pageShownSize(page: PdfPageBox): { height: number; width: number } {
  return page.rotation === 90 || page.rotation === 270
    ? { height: page.width, width: page.height }
    : { height: page.height, width: page.width }
}

/**
 * A point on the page as shown, in the PDF's own space: from its box's
 * bottom left, up, before the page is turned.
 *
 * @param page - The page.
 * @param fraction - How far across and down the shown page.
 * @returns The point, in points.
 */
export function pointOnPage(page: PdfPageBox, fraction: Readonly<{ x: number; y: number }>): { x: number; y: number } {
  const shown = pageShownSize(page)
  const across = fraction.x * shown.width
  const down = fraction.y * shown.height
  const [x, y] =
    page.rotation === 90
      ? [down, across]
      : page.rotation === 180
        ? [page.width - across, down]
        : page.rotation === 270
          ? [page.width - down, page.height - across]
          : [across, page.height - down]

  return { x: page.x + x, y: page.y + y }
}

/**
 * Where to draw a field's value so it covers the field as it was placed and
 * reads upright on the page as shown.
 *
 * @param field - The field, in fractions of the shown page.
 * @param page - The page.
 * @returns The corner to draw from, the size, and the turn.
 */
export function placeOnPage(field: PageFraction, page: PdfPageBox): PdfPlacement {
  const shown = pageShownSize(page)

  return {
    height: field.height * shown.height,
    origin: pointOnPage(page, { x: field.x, y: field.y + field.height }),
    rotate: page.rotation,
    width: field.width * shown.width,
  }
}

/** Which edges of a field are being dragged. */
export type FieldEdges = Readonly<{ bottom?: boolean; left?: boolean; right?: boolean; top?: boolean }>

/**
 * Reshapes a field by dragging some of its edges, as fractions of the page:
 * the edges not held stay put, the field never shrinks below its floor, and
 * it never leaves the page.
 *
 * @param field - Where the field is.
 * @param edges - The edges being dragged.
 * @param dx - How far across they moved.
 * @param dy - How far down they moved.
 * @param min - The smallest width and height a field may have.
 * @returns Where the field is now.
 */
export function reshapeField(field: PageFraction, edges: FieldEdges, dx: number, dy: number, min: Readonly<{ height: number; width: number }>): PageFraction {
  const right = field.x + field.width
  const bottom = field.y + field.height
  const left = edges.left ? clamp(field.x + dx, 0, right - min.width) : field.x
  const top = edges.top ? clamp(field.y + dy, 0, bottom - min.height) : field.y
  const newRight = edges.right ? clamp(right + dx, left + min.width, 1) : right
  const newBottom = edges.bottom ? clamp(bottom + dy, top + min.height, 1) : bottom

  return { height: newBottom - top, width: newRight - left, x: left, y: top }
}
