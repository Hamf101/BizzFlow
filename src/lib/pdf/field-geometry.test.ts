import { describe, expect, it } from "vitest"

import { normalizeRotation, pageShownSize, placeOnPage, pointOnPage, type PdfPageBox } from "./field-geometry"

// A page whose shown box starts away from the origin, as a cropped page does.
const box = (rotation: PdfPageBox["rotation"]): PdfPageBox => ({ height: 800, rotation, width: 600, x: 10, y: 20 })
const FIELD = { height: 0.05, width: 0.3, x: 0.1, y: 0.2 }

// Turns a vector anticlockwise by a multiple of a right angle, as a PDF rotation does.
function turn([x, y]: [number, number], degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180
  return [Math.round(x * Math.cos(radians) - y * Math.sin(radians)), Math.round(x * Math.sin(radians) + y * Math.cos(radians))]
}

describe("placing a field on a PDF page", () => {
  it("turned a quarter, reads the page as shown: its top left is the box's bottom left", () => {
    expect(pageShownSize(box(90))).toEqual({ height: 600, width: 800 })
    expect(pointOnPage(box(90), { x: 0, y: 0 })).toEqual({ x: 10, y: 20 })
    expect(placeOnPage(FIELD, box(90))).toEqual({ height: 30, origin: { x: 160, y: 100 }, rotate: 90, width: 240 })
  })

  it("covers exactly where the field was placed, upright, however the page is turned", () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const page = box(rotation)
      const placed = placeOnPage(FIELD, page)
      const at = (x: number, y: number) => pointOnPage(page, { x, y })
      const from = (vector: [number, number]) => {
        const [dx, dy] = turn(vector, placed.rotate)
        return { x: Math.round(placed.origin.x + dx), y: Math.round(placed.origin.y + dy) }
      }

      // The drawing's bottom right and top left land on the field's, as it was shown.
      expect(from([placed.width, 0])).toEqual(at(FIELD.x + FIELD.width, FIELD.y + FIELD.height))
      expect(from([0, placed.height])).toEqual(at(FIELD.x, FIELD.y))
      expect(from([placed.width, placed.height])).toEqual(at(FIELD.x + FIELD.width, FIELD.y))
    }
  })

  it("reads odd rotations the way viewers do", () => {
    expect([0, 90, -90, 180, 270, 360, 450, 89, -270].map(normalizeRotation)).toEqual([0, 90, 270, 180, 270, 0, 90, 90, 90])
  })
})
