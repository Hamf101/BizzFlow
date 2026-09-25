/**
 * A piece of the folded page: its group, and where its middle sits. A line
 * drawn across the page, rather than a piece of it, never stays behind.
 */
export type FoldPiece = { center: Point; element: Element; line?: boolean }

type Point = { x: number; y: number }
type Span = [low: number, high: number]
type Wave = { period: number; phase: number; reach: number }

// The page peels from its edges inward: each piece swings out a moment after
// the ones outside it, off to its own side and at its own pace, while one or
// two pieces near its middle stay close by. Then every piece drifts wherever
// its own current takes it, and glides home from wherever it has got to.
const RIPPLE_MS = 900
const OPENING_MS: Span = [1_400, 2_300]
const TOGETHER_MS = 7_000
// Water resistance, how firmly the screen's edges turn a straying piece back,
// and how loosely a piece that stays near the middle is held there.
const DRAG = 0.6
const FENCE = 3
const TETHER = 0.8
// Frames close enough together that straight lines between them read as
// curves: finer while a piece swings out and slows, when it moves fastest.
const OPENING_STEP_MS = 30
const STEP_MS = 120
// The drift is worked out in small steps and sampled into frames.
const TICK_MS = 10

// Starts and ends at rest with no jolt: zero speed and zero acceleration.
function settle(share: number): number {
  const u = Math.min(1, Math.max(0, share))

  return u * u * u * (u * (u * 6 - 15) + 10)
}

function between(random: () => number, low: number, high: number): number {
  return low + random() * (high - low)
}

function waveOf(random: () => number, period: [number, number], reach: [number, number]): Wave {
  return { period: between(random, ...period), phase: random() * 2 * Math.PI, reach: between(random, ...reach) }
}

function at(wave: Wave, ms: number): number {
  return wave.reach * Math.sin((2 * Math.PI * ms) / wave.period + wave.phase)
}

// Every piece moves about the page's middle, the group's origin, so a turn
// about the piece's own middle is spelled out.
function placed(offset: Point, turn: number, center: Point): string {
  return `translate(${offset.x.toFixed(2)}px, ${offset.y.toFixed(2)}px) translate(${center.x}px, ${center.y}px) rotate(${turn.toFixed(2)}deg) translate(${-center.x}px, ${-center.y}px)`
}

// How hard the screen's edge turns a piece back: not at all well inside it,
// then harder the further past the line the piece has strayed.
function fence(at: number, [low, high]: Span): number {
  return at < low ? (low - at) * FENCE : at > high ? (high - at) * FENCE : 0
}

/**
 * One piece's whole trip, worked out ahead. It waits for the peeling to reach
 * it, swings out (unless it stays near the middle), drifts on its own current,
 * turned back by the screen's edges, and then glides home from wherever it has
 * got to. Every frame, the last included, follows the same path, so nothing
 * ever snaps or spins to catch up.
 */
function float(
  piece: FoldPiece,
  release: number,
  screen: { x: Span; y: Span },
  homeAt: number,
  stays: boolean,
  random: () => number
): Animation {
  const total = homeAt + TOGETHER_MS
  const opening = between(random, ...OPENING_MS)
  // Out from the page's middle and off to a side of its own, so the pieces fan
  // out rather than the whole page swirling one way.
  const side = random() < 0.5 ? -1 : 1
  const heading = Math.atan2(piece.center.y, piece.center.x) + side * between(random, 0.3, 0.8)
  const way = { x: Math.cos(heading), y: Math.sin(heading) }
  // It swings out into much of the room there is on each side, stopping short
  // of the screen's edge.
  const room = {
    x: Math.max(0, way.x > 0 ? screen.x[1] - piece.center.x : piece.center.x - screen.x[0]),
    y: Math.max(0, way.y > 0 ? screen.y[1] - piece.center.y : piece.center.y - screen.y[0]),
  }
  const swing = stays ? 0 : between(random, 0.45, 0.7)
  const hold = stays ? TETHER : 0
  // Its own current: a slow sweep and a smaller eddy on each axis, never the same twice.
  const current = {
    x: [waveOf(random, [18_000, 40_000], [8, 18]), waveOf(random, [6_000, 11_000], [3, 9])],
    y: [waveOf(random, [18_000, 40_000], [8, 18]), waveOf(random, [6_000, 11_000], [3, 9])],
  }
  // It turns the way it swings as it goes, then sways slowly, never spinning.
  const spin = side * between(random, 15, 35)
  const sway = waveOf(random, [14_000, 22_000], [8, 30])
  const place = { x: 0, y: 0 }
  const speed = { x: 0, y: 0 }
  const frames: Keyframe[] = []
  let sampleAt = 0

  for (let ms = 0; ms < total; ms += TICK_MS) {
    const opened = Math.min(1, Math.max(0, (ms - release) / opening))
    const loose = settle(opened)

    if (ms >= sampleAt) {
      const home = 1 - settle((ms - homeAt) / TOGETHER_MS)
      frames.push({
        offset: ms / total,
        transform: placed({ x: home * place.x, y: home * place.y }, home * loose * (spin + at(sway, ms)), piece.center),
      })
      sampleAt += ms < release + opening + 1_500 ? OPENING_STEP_MS : STEP_MS
    }

    if (opened > 0) {
      const thrust = swing * Math.sin(Math.PI * opened) ** 2
      const pull = {
        x:
          thrust * way.x * room.x +
          loose * (at(current.x[0]!, ms) + at(current.x[1]!, ms) + fence(piece.center.x + place.x, screen.x) - hold * place.x),
        y:
          thrust * way.y * room.y +
          loose * (at(current.y[0]!, ms) + at(current.y[1]!, ms) + fence(piece.center.y + place.y, screen.y) - hold * place.y),
      }
      speed.x += ((pull.x - DRAG * speed.x) * TICK_MS) / 1_000
      speed.y += ((pull.y - DRAG * speed.y) * TICK_MS) / 1_000
      place.x += (speed.x * TICK_MS) / 1_000
      place.y += (speed.y * TICK_MS) / 1_000
    }
  }

  frames.push({ offset: 1, transform: placed({ x: 0, y: 0 }, 0, piece.center) })

  return piece.element.animate(frames, { duration: total })
}

/**
 * Plays the page coming apart once: it peels from its edges inward, one or
 * two pieces near its middle stay close by, every other piece drifts on its
 * own, and they all come home together.
 *
 * @param pieces - The page's pieces.
 * @param corners - The screen's corners in the pieces' units, clockwise from top left.
 * @param floatMs - How long the pieces drift once the page has unfurled.
 * @param random - A source of numbers in [0, 1).
 * @returns One animation per piece.
 */
export function startFoldLoop(
  pieces: readonly FoldPiece[],
  corners: readonly Point[],
  floatMs: number,
  random: () => number
): Animation[] {
  const [topLeft, , bottomRight] = corners as [Point, Point, Point, Point]
  // Where a piece's middle may drift freely: nearly the whole screen, so the
  // edges only turn back a piece about to leave it.
  const inner = (low: number, high: number): Span => [low + (high - low) * 0.04, high - (high - low) * 0.04]
  const screen = { x: inner(topLeft.x, bottomRight.x), y: inner(topLeft.y, bottomRight.y) }
  const reach = (piece: FoldPiece): number => Math.hypot(piece.center.x, piece.center.y)
  const farthest = Math.max(...pieces.map(reach))
  const staying = new Set(
    pieces
      .filter((piece) => !piece.line)
      .sort((one, other) => reach(one) - reach(other))
      .slice(0, random() < 0.5 ? 1 : 2)
  )
  const homeAt = RIPPLE_MS + OPENING_MS[1] + floatMs

  return pieces.map((piece) =>
    float(
      piece,
      (1 - reach(piece) / farthest) * RIPPLE_MS + between(random, 0, 150),
      screen,
      homeAt,
      staying.has(piece),
      random
    )
  )
}

/**
 * Every few seconds, lets the page unfurl and drift for 10 to 15 seconds
 * before it folds back together, until stopped.
 *
 * @param figure - The group the pieces are drawn in, to find the screen's corners in it.
 * @param pieces - The page's pieces.
 * @returns Stops the loops and puts every piece back.
 */
export function playFoldLoops(figure: SVGGraphicsElement, pieces: readonly FoldPiece[]): () => void {
  let running: Animation[] = []
  let timer = 0
  const rest = (): void => {
    timer = window.setTimeout(play, 5_000 + Math.random() * 3_000)
  }
  const play = (): void => {
    const fromScreen = figure.getScreenCTM()?.inverse()

    if (!fromScreen) {
      rest()
      return
    }

    const corners = [
      [0, 0],
      [innerWidth, 0],
      [innerWidth, innerHeight],
      [0, innerHeight],
    ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(fromScreen))
    running = startFoldLoop(pieces, corners, 10_000 + Math.random() * 5_000, Math.random)
    // A stopped loop rejects, and nothing follows it.
    Promise.all(running.map((animation) => animation.finished)).then(rest, () => undefined)
  }

  rest()

  return () => {
    clearTimeout(timer)
    running.forEach((animation) => animation.cancel())
  }
}
