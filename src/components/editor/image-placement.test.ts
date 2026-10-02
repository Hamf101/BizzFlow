import { expect, it } from "vitest"

import { placeImage, snapBox } from "@/components/editor/image-placement"
import { imageBlockSchema } from "@/types/template"

it("keeps a dragged or resized picture wholly on its page", () => {
  expect(placeImage({ height: 20, page: 1, width: 30, x: 90, y: -4 })).toEqual({ height: 20, page: 1, width: 30, x: 70, y: 0 })
  expect(placeImage({ height: 0, page: 2.4, width: 200, x: 10, y: 10 })).toEqual({ height: 1, page: 2, width: 100, x: 0, y: 10 })
  // A saved document refuses a box that hangs off its page.
  expect(
    imageBlockSchema.safeParse({
      altText: "Logo",
      id: "60000000-0000-4000-8000-000000000001",
      placement: { height: 10, page: 1, width: 30, x: 90, y: 0 },
      type: "image",
    }).success
  ).toBe(false)
})

it("snaps a pinned box to the lines near it, and leaves it be beyond them", () => {
  const lines = { x: [0, 50, 300, 600], y: [0, 40, 400] }
  const box = { height: 60, width: 100, x: 53, y: 44 }

  // Its left edge meets the margin, and its top the line under it.
  expect(snapBox(box, lines, 6, "move")).toEqual({ box: { ...box, x: 50, y: 40 }, guides: { x: 50, y: 40 } })
  // Its middle meets the page's centre.
  expect(snapBox({ ...box, x: 248, y: 200 }, lines, 6, "move")).toEqual({ box: { ...box, x: 250, y: 200 }, guides: { x: 300 } })
  // Too far from any line, nothing moves.
  expect(snapBox({ ...box, x: 120, y: 200 }, lines, 6, "move")).toEqual({ box: { ...box, x: 120, y: 200 }, guides: {} })
  // Resizing, only the far edges snap, and the box grows to them.
  expect(snapBox({ ...box, width: 546 }, lines, 6, "resize")).toEqual({ box: { ...box, width: 547 }, guides: { x: 600 } })
})
