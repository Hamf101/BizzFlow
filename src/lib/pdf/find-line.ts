/** A line found on a drawn page, as fractions of the page: where it starts and ends, and its height. */
export type FoundLine = Readonly<{ x0: number; x1: number; y: number }>

/**
 * Finds the line someone tapped to put a field on: the longest run of dark
 * pixels across a row near the tap, mostly just below it, as people tap a
 * little above a line. Typed underscores join over their small gaps; a line
 * is nearly all ink along its length, which the row where letters stand on
 * their baseline never is, however long.
 *
 * @param pixels - The page as drawn, RGBA, row by row.
 * @param width - The drawing's width in pixels.
 * @param height - Its height in pixels.
 * @param at - Where it was tapped, as fractions of the page.
 * @returns The line, or null when none is near.
 */
export function findLine(pixels: Uint8ClampedArray, width: number, height: number, at: Readonly<{ x: number; y: number }>): FoundLine | null {
  const tapX = Math.round(at.x * width)
  const tapY = Math.round(at.y * height)
  // About 10pt above and 24pt below the tap on a Letter page.
  const top = Math.max(0, tapY - Math.round(height * 0.012))
  const bottom = Math.min(height - 1, tapY + Math.round(height * 0.03))
  const gap = Math.max(2, Math.round(width * 0.002))
  const solid = 0.85
  const shortest = Math.round(width * 0.06)
  // The tap may fall just past either end.
  const reach = Math.round(width * 0.05)
  let best: { distance: number; length: number; row: number; start: number; end: number } | null = null

  for (let row = top; row <= bottom; row += 1) {
    let start = -1
    let lastDark = -1
    let ink = 0

    // One step past the row's end closes a run that reaches it.
    for (let column = 0; column <= width; column += 1) {
      const dark = column < width && isDark(pixels, (row * width + column) * 4)

      if (dark) {
        if (start < 0 || column - lastDark > gap) {
          consider(start, lastDark + 1, ink)
          start = column
          ink = 0
        }
        lastDark = column
        ink += 1
      }
    }
    consider(start, lastDark + 1, ink)

    function consider(runStart: number, runEnd: number, inked: number): void {
      if (runStart < 0 || runEnd - runStart < shortest || inked / (runEnd - runStart) < solid) return
      if (tapX < runStart - reach || tapX > runEnd + reach) return
      const distance = Math.abs(row - tapY)

      if (!best || distance < best.distance || (distance === best.distance && runEnd - runStart > best.length)) {
        best = { distance, end: runEnd, length: runEnd - runStart, row, start: runStart }
      }
    }
  }

  const found = best as { end: number; row: number; start: number } | null
  return found ? { x0: found.start / width, x1: found.end / width, y: found.row / height } : null
}

function isDark(pixels: Uint8ClampedArray, index: number): boolean {
  return pixels[index + 3]! > 128 && pixels[index]! * 0.299 + pixels[index + 1]! * 0.587 + pixels[index + 2]! * 0.114 < 160
}
