import { expect, it } from "vitest"

import { startFoldLoop } from "@/components/auth/fold-loops"

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

/** Sixty loops, each on its own random draws: every piece's planned trip, frame by frame, timed from the loop's start. */
function everyRun(): Step[][][] {
  const runs: Step[][][] = []

  for (let seed = 1; seed <= 60; seed++) {
    const trips: Step[][] = []
    const planned = pieces.map((piece) => ({
      ...piece,
      element: {
        animate(frames: Keyframe[], { delay = 0, duration }: { delay?: number; duration: number }) {
          trips.push(
            frames.map((frame) => {
              const [x, y] = String(frame.transform).match(/-?\d+\.\d+(?=px)/g)!.map(Number)
              const turn = Number(String(frame.transform).match(/rotate\((-?\d+\.\d+)deg\)/)![1])
              return { ms: delay + frame.offset! * duration, offset: frame.offset!, turn, x: x!, y: y! }
            })
          )
          return {}
        },
      } as unknown as Element,
    }))

    startFoldLoop(planned, corners, 12_000, seeded(seed))
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
  for (const trip of everyRun().flat()) {
    const last = trip.at(-1)!

    expect(last.offset).toBe(1)
    expect([last.x, last.y, last.turn].map(Math.abs)).toEqual([0, 0, 0])
    for (let index = 1; index < trip.length; index++) {
      expect(Math.abs(trip[index]!.turn - trip[index - 1]!.turn)).toBeLessThan(6)
      expect(Math.hypot(trip[index]!.x - trip[index - 1]!.x, trip[index]!.y - trip[index - 1]!.y)).toBeLessThan(25)
    }
  }
})
