import { expect, it } from "vitest"

import { findLine } from "./find-line"

// A white page drawn at 600 × 800 pixels, with dark marks painted in.
function page(marks: ReadonlyArray<{ x0: number; x1: number; y: number; thickness?: number }>): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(600 * 800 * 4).fill(255)
  for (const mark of marks) {
    for (let y = mark.y; y < mark.y + (mark.thickness ?? 2); y += 1) {
      for (let x = mark.x0; x < mark.x1; x += 1) {
        pixels.set([30, 30, 30, 255], (y * 600 + x) * 4)
      }
    }
  }
  return pixels
}

// Words drawn as short dark strokes with gaps, as text looks row by row.
const words = Array.from({ length: 12 }, (_, n) => ({ thickness: 6, x0: 60 + n * 14, x1: 68 + n * 14, y: 494 }))

it("finds the line tapped just above, from its start to its end, ignoring the words beside it", () => {
  const pixels = page([...words, { x0: 240, x1: 420, y: 500 }])

  expect(findLine(pixels, 600, 800, { x: 300 / 600, y: 488 / 800 })).toEqual({ x0: 240 / 600, x1: 420 / 600, y: 500 / 800 })
})

it("takes the line, not the row where the words above it stand", () => {
  // Letters' feet line up along a baseline: a long row, but more gap than ink.
  const feet = Array.from({ length: 60 }, (_, n) => ({ x0: 60 + n * 4, x1: 63 + n * 4, y: 488 }))
  const pixels = page([...feet, { x0: 240, x1: 420, y: 500 }])

  expect(findLine(pixels, 600, 800, { x: 300 / 600, y: 486 / 800 })).toEqual({ x0: 240 / 600, x1: 420 / 600, y: 500 / 800 })
})

it("joins the small gaps between typed underscores into one line", () => {
  const dashes = Array.from({ length: 20 }, (_, n) => ({ x0: 100 + n * 8, x1: 107 + n * 8, y: 300 }))

  expect(findLine(page(dashes), 600, 800, { x: 150 / 600, y: 295 / 800 })).toEqual({ x0: 100 / 600, x1: 259 / 600, y: 300 / 800 })
})

it("finds nothing where there is no line near the tap", () => {
  expect(findLine(page(words), 600, 800, { x: 100 / 600, y: 490 / 800 })).toBeNull()
  // A line too far below the tap belongs to something else.
  expect(findLine(page([{ x0: 100, x1: 400, y: 700 }]), 600, 800, { x: 200 / 600, y: 400 / 800 })).toBeNull()
})
