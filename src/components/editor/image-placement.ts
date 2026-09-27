import type { TemplateBlock } from "@/types/template"

type Placement = NonNullable<Extract<TemplateBlock, { type: "image" }>["placement"]>

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
