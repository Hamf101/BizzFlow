import type { TemplateBlock } from "@/types/template"

type Placement = NonNullable<Extract<TemplateBlock, { type: "image" }>["placement"]>

type Box = Readonly<{ height: number; width: number; x: number; y: number }>

/**
 * Snaps a box being moved or resized to the lines near it: the page's edges,
 * margins and middle, and other pinned blocks' edges and middles. Moving, its
 * nearest edge or middle meets a line; resizing, its far edges do. The line
 * met on each axis is returned, to draw as a guide.
 *
 * @param box - The box, in pixels from the page's corner.
 * @param lines - Where lines run across and down the page, in the same pixels.
 * @param threshold - How near, in pixels, a line pulls.
 * @param how - Whether the box is moving or being resized.
 * @returns The snapped box, and the lines it meets.
 */
export function snapBox(
  box: Box,
  lines: Readonly<{ x: readonly number[]; y: readonly number[] }>,
  threshold: number,
  how: "move" | "resize"
): { box: Box; guides: { x?: number; y?: number } } {
  const guides: { x?: number; y?: number } = {}
  const snapped = { ...box }

  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? box.width : box.height
    const start = box[axis]
    const points = how === "move" ? [start, start + size / 2, start + size] : [start + size]
    let best: { line: number; shift: number } | null = null

    for (const point of points) {
      for (const line of lines[axis]) {
        const shift = line - point

        if (Math.abs(shift) <= threshold && (!best || Math.abs(shift) < Math.abs(best.shift))) {
          best = { line, shift }
        }
      }
    }

    if (best) {
      guides[axis] = best.line

      if (how === "move") {
        snapped[axis] = start + best.shift
      } else if (axis === "x") {
        snapped.width = size + best.shift
      } else {
        snapped.height = size + best.shift
      }
    }
  }

  return { box: snapped, guides }
}

/**
 * Keeps a picture's box on its page: at least 1% on each side, no larger than
 * the page, and wholly inside it.
 *
 * @param value - The box asked for, in percentages of the page.
 * @returns The box, moved and trimmed to fit.
 */
export function placeImage(value: Placement): Placement {
  const width = Math.max(1, Math.min(100, value.width))
  const height = Math.max(1, Math.min(100, value.height))

  return {
    height,
    page: Math.max(1, Math.min(100, Math.round(value.page))),
    width,
    x: Math.max(0, Math.min(100 - width, value.x)),
    y: Math.max(0, Math.min(100 - height, value.y)),
  }
}

/**
 * Finds the page of the canvas nearest a point on the screen, so a picture
 * dragged between pages lands on the one it was let go over.
 *
 * @param inside - Any element on the canvas.
 * @param clientY - How far down the screen the point is.
 * @returns The page's element and number, or null off the paged canvas.
 */
export function pageUnder(inside: Element, clientY: number): { element: HTMLElement; number: number } | null {
  const pages = [...(inside.closest("[data-slot=editor-pages]")?.querySelectorAll<HTMLElement>("[data-page]") ?? [])]
  const distance = (page: HTMLElement): number => {
    const { bottom, top } = page.getBoundingClientRect()

    return clientY < top ? top - clientY : clientY > bottom ? clientY - bottom : 0
  }
  const nearest = pages.reduce<HTMLElement | null>((best, page) => (!best || distance(page) < distance(best) ? page : best), null)

  return nearest ? { element: nearest, number: Number(nearest.dataset.page) } : null
}

/**
 * The box a picture now in the text fills on its page, so placing it freely
 * leaves it where it is.
 *
 * @param picture - The picture's element.
 * @returns The box, or null off the paged canvas.
 */
export function placementOf(picture: Element): Placement | null {
  const box = picture.getBoundingClientRect()
  const page = pageUnder(picture, box.top)
  const bounds = page?.element.getBoundingClientRect()

  if (!page || !bounds || box.width === 0) {
    return null
  }

  return placeImage({
    height: (box.height / bounds.height) * 100,
    page: page.number,
    width: (box.width / bounds.width) * 100,
    x: ((box.left - bounds.left) / bounds.width) * 100,
    y: ((box.top - bounds.top) / bounds.height) * 100,
  })
}
