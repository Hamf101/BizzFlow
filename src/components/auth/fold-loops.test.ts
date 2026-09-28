import { expect, it, vi } from "vitest"

import { gatherHome, startFoldLoop } from "@/components/auth/fold-loops"

type Step = { ms: number; offset: number; turn: number; x: number; y: number }

// A repeatable stand-in for Math.random.
function seeded(seed: number): () => number {
  let state = seed

  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296
    return state / 4_294_967_296
  }
}

const corners = [
  { x: -520, y: -330 },
  { x: 520, y: -330 },
  { x: 520, y: 330 },
  { x: -520, y: 330 },
]
// Nearest the page's middle first. The first is a line drawn across the page, not a piece of it.
const pieces = [
  { center: { x: 0, y: -20 }, line: true },
  { center: { x: 60, y: 40 } },
  { center: { x: 120, y: -170 } },
  { center: { x: -150, y: 190 } },
]

// Where a frame puts a piece: its offset from home and its turn about its own middle.
function read(frame: Keyframe): { turn: number; x: number; y: number } {
  const [x, y] = String(frame.transform).match(/-?\d+\.\d+(?=px)/g)!.map(Number)
  const turn = Number(String(frame.transform).match(/rotate\((-?\d+\.\d+)deg\)/)![1])

  return { turn, x: x!, y: y! }
}

/**
 * Sixty loops, each on its own random draws: every piece's planned trip, frame
 * by frame, timed from the loop's start, on a screen `scale` px to the page's unit.
 */
function everyRun(scale = 1, count = 60): Step[][][] {
  const runs: Step[][][] = []

  for (let seed = 1; seed <= count; seed++) {
    const trips: Step[][] = []
    const planned = pieces.map((piece) => ({
      ...piece,
      element: {
        animate(frames: Keyframe[], { delay = 0, duration }: { delay?: number; duration: number }) {
          trips.push(
            frames.map((frame) => ({ ms: delay + frame.offset! * duration, offset: frame.offset!, ...read(frame) }))
          )
          return {}
        },
      } as unknown as Element,
    }))

    startFoldLoop(planned, corners, 12_000, seeded(seed), scale)
    runs.push(trips)
  }

  return runs
}

it("peels from the edges inward, then folds back together all at once", () => {
  for (const trips of everyRun()) {
    const starts = trips.map((trip) => trip.find((step) => Math.hypot(step.x, step.y) > 1)?.ms ?? Infinity)
    const landings = trips.map((trip) => trip.at(-1)!.ms)

    expect(starts[0]! - starts.at(-1)!).toBeGreaterThan(400)
    expect(new Set(landings).size).toBe(1)
  }
})

it("swings each piece out its own way, never the whole page in step", () => {
  // Which way round the middle the line and the outermost piece, which both always peel, have swung.
  const sides = everyRun().map((trips) =>
    [0, 3].map((index) => {
      const { x, y } = trips[index]!.find((step) => step.ms >= 3_000)!
      return Math.sign(pieces[index]!.center.x * y - pieces[index]!.center.y * x)
    })
  )
  const inStep = sides.filter(([one, other]) => one === other).length / sides.length

  expect(inStep).toBeGreaterThan(0.2)
  expect(inStep).toBeLessThan(0.8)
})

it("keeps one or two of the pieces nearest the middle close by it, never a line", () => {
  for (const trips of everyRun()) {
    const stayed = trips.map((trip) => trip.every((step) => Math.hypot(step.x, step.y) < 50))

    expect([
      [false, true, false, false],
      [false, true, true, false],
    ]).toContainEqual(stayed)
  }
})

it("brings every piece home upright, with no sudden jump or spin on the way", () => {
  for (const trip of everyRun(1, 20).flat()) {
    const last = trip.at(-1)!

    expect(last.offset).toBe(1)
    expect([last.x, last.y, last.turn].map(Math.abs)).toEqual([0, 0, 0])
    for (let index = 1; index < trip.length; index++) {
      expect(Math.abs(trip[index]!.turn - trip[index - 1]!.turn)).toBeLessThan(6)
      expect(Math.hypot(trip[index]!.x - trip[index - 1]!.x, trip[index]!.y - trip[index - 1]!.y)).toBeLessThan(25)
    }
  }
})

it("moves each piece as far across the screen as the page is drawn large", () => {
  const [planned, doubled] = [everyRun(1, 10).flat(2), everyRun(2, 10).flat(2)]

  expect(doubled).toHaveLength(planned.length)
  doubled.forEach((step, index) => {
    expect(step.turn).toBeCloseTo(planned[index]!.turn, 1)
    expect(step.x).toBeCloseTo(2 * planned[index]!.x, 1)
    expect(step.y).toBeCloseTo(2 * planned[index]!.y, 1)
  })
})

it("brings pieces caught mid-drift straight home from where they are, all together", () => {
  // The page drawn at two screen px to its unit.
  const scale = 2
  // Two pieces the page was left with: each moved off and turned about its own middle.
  const drifted = [
    { turn: 24, x: 38, y: -52 },
    { turn: -31, x: -70, y: 45 },
  ]
  const cancelled: number[] = []
  const trips: { duration: unknown; frames: Keyframe[] }[] = []
  const caught = drifted.map(({ turn, x, y }, index) => {
    const center = pieces[index + 1]!.center
    const [cos, sin] = [Math.cos((turn * Math.PI) / 180), Math.sin((turn * Math.PI) / 180)]
    // As the browser reports it, in screen px: the turn, and where the page's middle has gone.
    const now = `matrix(${cos}, ${sin}, ${-sin}, ${cos}, ${scale * (center.x + x - (center.x * cos - center.y * sin))}, ${scale * (center.y + y - (center.x * sin + center.y * cos))})`

    return {
      center,
      element: {
        animate(frames: Keyframe[], { duration }: KeyframeAnimationOptions) {
          trips.push({ duration, frames })
          return {}
        },
        now,
      } as unknown as Element,
    }
  })
  vi.stubGlobal("getComputedStyle", (element: { now: string }) => ({ transform: element.now }))
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      a: number
      b: number
      e: number
      f: number

      constructor(transform: string) {
        ;[this.a, this.b, , , this.e, this.f] = transform.match(/-?[\d.]+(?:e-?\d+)?/g)!.map(Number) as number[]
      }
    }
  )

  gatherHome(
    caught,
    [0, 1].map((index) => ({ cancel: () => cancelled.push(index) }) as unknown as Animation),
    scale
  )
  vi.unstubAllGlobals()

  expect(cancelled).toEqual([0, 1])
  expect(new Set(trips.map((trip) => trip.duration)).size).toBe(1)
  trips.forEach(({ frames }, index) => {
    const [from, home] = [read(frames[0]!), read(frames.at(-1)!)]

    expect(Math.abs(from.turn - drifted[index]!.turn)).toBeLessThan(0.01)
    expect(Math.hypot(from.x - scale * drifted[index]!.x, from.y - scale * drifted[index]!.y)).toBeLessThan(0.01)
    expect([home.x, home.y, home.turn].map(Math.abs)).toEqual([0, 0, 0])
  })
})
