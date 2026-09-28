"use client"

import { type CSSProperties, type ReactElement, type RefObject, useEffect, useRef } from "react"

import { CORNERS, FACETS } from "@/components/brand/folded-page"

// The logo's own facets, each centred on its middle and scaled to a radius of one.
const SHAPES = FACETS.map(({ corners, strength, tones }) => {
  const points = corners.map((corner) => CORNERS[corner])
  const middle = [0, 1].map((axis) => points.reduce((sum, point) => sum + point[axis]!, 0) / 3) as [number, number]
  const radius = Math.max(...points.map(([x, y]) => Math.hypot(x - middle[0], y - middle[1])))

  return { points: points.map(([x, y]) => [(x - middle[0]) / radius, (y - middle[1]) / radius] as const), strength, tone: tones[0] }
})
const POOL = 11

type Spot = { x: number; y: number }
type Travel = Readonly<{ alpha?: number; bow?: number; delay?: number; dur?: number; from?: Spot | null; turn?: number }>
type Piece = Spot & {
  alpha: number
  alphaFrom: number
  alphaTo: number
  ctrl: Spot
  dur: number
  from: Spot | null
  rot: number
  rotFrom: number
  rotTo: number
  settle: number
  /** Whether it keeps still, for people who turn motion off. */
  still: boolean
  t0: number
  to: Spot
  /** Its own character: how far, how fast and from where it wanders and turns. */
  wander: Readonly<{ ax: number; ay: number; ar: number; px: number; py: number; pr: number; wx: number; wy: number; wr: number }>
}
type Flock = Readonly<{ pieces: readonly Piece[]; start: Piece }>
type View = Readonly<{ narrow: boolean; sectionId: string | null; zoom: number }>
type Geometry = Readonly<{ band: readonly [number, number]; rows: readonly { bottom: number; top: number }[]; start: Spot }>

// Each piece's character is fixed, so the pieces look the same on every visit.
const random = seeded("bizflow pieces")
const CHARACTER = Array.from({ length: POOL }, (_, index) => ({
  shape: SHAPES[(index * 4) % SHAPES.length]!,
  size: 0.62 + random() * 0.38,
  wander: {
    ax: 0.5 + random() * 0.5,
    ay: 0.5 + random() * 0.5,
    ar: 9 + random() * 20,
    wx: (Math.PI * 2) / (8 + random() * 13),
    wy: (Math.PI * 2) / (10 + random() * 14),
    wr: (Math.PI * 2) / (12 + random() * 19),
    px: random() * 6.28,
    py: random() * 6.28,
    pr: random() * 6.28,
  },
}))

/**
 * Marks the section being written in with the logo's pieces, drifting in the
 * margin beside it. A starting triangle points at the section's title. When
 * the caret moves to another section the triangle goes first, and the pieces
 * break away and follow, each on its own curve and at its own pace; when the
 * section grows or shrinks they glide to their new places. On a phone they sit
 * half off the screen's edge, clear of the words. Never printed, and still for
 * people who turn motion off.
 *
 * @param props - The canvas, the section the caret is in, how the canvas is
 *   shown, and what changes when its layout does.
 * @returns The pieces.
 */
export function SectionPieces({
  narrow,
  revision,
  root,
  sectionId,
  zoom,
}: {
  narrow: boolean
  revision: unknown
  root: RefObject<HTMLDivElement | null>
  sectionId: string | null
  zoom: number
}): ReactElement {
  const nodes = useRef<(SVGGElement | null)[]>([])
  const state = useRef<Flock>({ pieces: CHARACTER.map(({ wander }) => resting(wander)), start: resting(CHARACTER[0]!.wander) })
  const latest = useRef<View>({ narrow, sectionId, zoom })

  useEffect(() => {
    latest.current = { narrow, sectionId, zoom }
  })

  useEffect(() => {
    if (typeof requestAnimationFrame !== "function") {
      return
    }

    let frame = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000)
      const { pieces, start } = state.current

      last = now
      pieces.forEach((piece, index) => draw(nodes.current[index], piece, now, dt, false, latest.current.narrow))
      draw(nodes.current[POOL], start, now, dt, true, latest.current.narrow)
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [])

  // A move to another section breaks away; writing only glides.
  useEffect(() => retarget(root.current, state.current, latest.current, "move"), [root, sectionId, narrow])
  useEffect(() => retarget(root.current, state.current, latest.current, "gentle"), [root, revision, zoom])
  useEffect(() => {
    const canvas = root.current

    if (!canvas || typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver(() => retarget(root.current, state.current, latest.current, "gentle"))
    observer.observe(canvas)

    return () => observer.disconnect()
  }, [root])

  const radius = narrow ? 6.4 : 11
  const corner = narrow ? 4.6 : 6.5

  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible print:hidden" data-slot="section-pieces">
      {CHARACTER.map(({ shape, size }, index) => (
        <g key={index} ref={(node) => void (nodes.current[index] = node)} style={{ opacity: 0 }}>
          <polygon
            points={shape.points.map(([x, y]) => `${(x * radius * size).toFixed(2)},${(y * radius * size).toFixed(2)}`).join(" ")}
            strokeLinejoin="round"
            strokeWidth={narrow ? 0.7 : 0.9}
            style={tint(shape.tone, shape.strength)}
          />
        </g>
      ))}
      {/* The logo's folded corner, pointing at the section's title. */}
      <g ref={(node) => void (nodes.current[POOL] = node)} style={{ opacity: 0 }}>
        <polygon
          points={`0,0 ${-corner},${-corner} ${-corner},${corner}`}
          strokeLinejoin="round"
          strokeWidth={narrow ? 0.8 : 1}
          style={tint("wisteria", 1.3)}
        />
      </g>
    </svg>
  )
}

function retarget(canvas: HTMLElement | null, pieces: Flock, view: View, mode: "gentle" | "move"): void {
  const { narrow: phone, sectionId: section, zoom: scale } = view

  if (!canvas) {
    return
  }

  const now = performance.now()
  const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const geometry = section ? measure(canvas, section, phone, scale) : null
  const busy = (piece: Piece): boolean => piece.from !== null && now < piece.t0 + piece.dur
  const home = geometry?.start ?? { x: pieces.start.x, y: pieces.start.y }
  const spots = geometry && section ? homes(geometry, section, phone) : []

  const stays = (piece: Piece, spot: Spot): boolean =>
    mode === "gentle" && piece.alpha > 0.5 && Math.abs(spot.x - piece.to.x) < 0.5 && Math.abs(spot.y - piece.to.y) < 0.5

  if (!(mode === "gentle" && (busy(pieces.start) || stays(pieces.start, home)))) {
    travel(pieces.start, home, now, reduce, {
      alpha: geometry ? 1 : 0,
      dur: mode === "gentle" ? 260 : 620,
      from: pieces.start.alpha < 0.02 ? home : null,
    })
  }

  pieces.pieces.forEach((piece, index) => {
    const spot = spots[index]
    const turn = (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 150)
    const bow = -(16 + Math.random() * 50)

    // Writing that moves nothing leaves the pieces wandering where they are.
    if (mode === "gentle" && (busy(piece) || (spot && stays(piece, spot)))) {
      return
    }

    if (spot) {
      const glide = mode === "gentle" && piece.alpha > 0.5

      travel(piece, spot, now, reduce, {
        bow: glide ? 0 : bow,
        delay: glide ? 0 : 50 + Math.random() * 280,
        dur: glide ? 420 : 950 + Math.random() * 700,
        // A piece that was not showing comes out of the starting triangle.
        from: piece.alpha < 0.05 ? home : null,
        turn: glide ? 0 : turn,
      })
    } else if (piece.alpha > 0.01 || (piece.from && piece.alphaTo > 0)) {
      // One the section no longer needs folds back into the triangle.
      travel(piece, home, now, reduce, { alpha: 0, bow: bow * 0.5, delay: Math.random() * 160, dur: 620 + Math.random() * 380, turn })
    }
  })
}

function tint(tone: string, strength: number): CSSProperties {
  return {
    fill: `color-mix(in oklch, var(--fold-${tone}) calc(${strength} * var(--fold-strength) * 100%), var(--card))`,
    stroke: "var(--fold-seam)",
  }
}

function resting(wander: Piece["wander"]): Piece {
  return {
    alpha: 0,
    alphaFrom: 0,
    alphaTo: 0,
    ctrl: { x: 0, y: 0 },
    dur: 1,
    from: null,
    rot: 0,
    rotFrom: 0,
    rotTo: 0,
    settle: 0,
    still: false,
    t0: 0,
    to: { x: 0, y: 0 },
    wander,
    x: 0,
    y: 0,
  }
}

// Sends a piece to a spot: a quick break, then a slow drift along its own bow.
function travel(piece: Piece, to: Spot, now: number, reduce: boolean, options: Travel): void {
  const here = options.from ?? { x: piece.x, y: piece.y }
  const distance = Math.hypot(to.x - here.x, to.y - here.y)

  piece.from = here
  piece.to = to
  piece.t0 = now + (reduce ? 0 : (options.delay ?? 0))
  piece.dur = reduce || !options.dur ? 1 : options.dur + Math.min(900, distance * 0.45)
  piece.ctrl = {
    x: (here.x + to.x) / 2 + (options.bow ?? 0),
    y: (here.y + to.y) / 2 + (Math.random() - 0.5) * Math.min(40, distance * 0.2),
  }
  piece.rotFrom = piece.rot
  piece.rotTo = piece.rot + (reduce ? 0 : (options.turn ?? 0))
  piece.alphaFrom = options.from ? 0 : piece.alpha
  piece.alphaTo = options.alpha ?? 1
  piece.settle = 0
  piece.still = reduce
}

function draw(node: SVGGElement | null | undefined, piece: Piece, now: number, dt: number, start: boolean, phone: boolean): void {
  if (!node || !piece.from) {
    return
  }

  const k = Math.min(1, Math.max(0, (now - piece.t0) / piece.dur))
  const eased = 1 - Math.pow(1 - k, 4)
  const remaining = 1 - eased
  const x = remaining * remaining * piece.from.x + 2 * remaining * eased * piece.ctrl.x + eased * eased * piece.to.x
  const y = remaining * remaining * piece.from.y + 2 * remaining * eased * piece.ctrl.y + eased * eased * piece.to.y
  const { ar, ax, ay, pr, px, py, wr, wx, wy } = piece.wander
  const t = now / 1000

  // Once home, each piece wanders on its own; the triangle only wobbles on its way.
  piece.settle = k < 1 ? 0 : Math.min(1, piece.settle + dt / 1.6)
  const weight = piece.still || start ? 0 : piece.settle * piece.settle * (3 - 2 * piece.settle)
  const reach = phone ? 0.45 : 1
  const turn = start ? (k < 1 && !piece.still ? -26 * Math.sin(Math.PI * eased) : 0) : weight * ar * Math.sin(t * wr + pr)
  const base = piece.rotFrom + (piece.rotTo - piece.rotFrom) * eased

  piece.alpha = piece.alphaFrom + (piece.alphaTo - piece.alphaFrom) * Math.min(1, k * 1.7)
  piece.x = x + weight * reach * ax * 4 * Math.sin(t * wx + px)
  piece.y = y + weight * reach * ay * 7 * Math.sin(t * wy + py)
  piece.rot = start ? 0 : base + turn
  node.setAttribute("transform", `translate(${piece.x.toFixed(2)} ${piece.y.toFixed(2)}) rotate(${(base + turn).toFixed(2)})`)
  node.style.opacity = piece.alpha.toFixed(3)
}

// Where the section sits on the canvas, in the canvas's own pixels.
function measure(canvas: HTMLElement, sectionId: string, phone: boolean, zoom: number): Geometry | null {
  const origin = canvas.getBoundingClientRect()
  const box = (element: Element) => {
    const rect = element.getBoundingClientRect()

    return { bottom: (rect.bottom - origin.top) / zoom, left: (rect.left - origin.left) / zoom, top: (rect.top - origin.top) / zoom }
  }
  const units = [...canvas.querySelectorAll<HTMLElement>("[data-unit-id]")].filter((unit) => unit.dataset.sectionId === sectionId).map(box)
  const first = units[0]

  if (!first) {
    return null
  }

  const titleElement = [...canvas.querySelectorAll<HTMLElement>("[data-section-title]")].find((title) => title.dataset.sectionTitle === sectionId)
  const title = titleElement ? box(titleElement) : first
  const middle = title.top + Math.min(title.bottom - title.top, phone ? 29 : 26) / 2
  const inner = Math.min(16, first.left * 0.3)

  return {
    band: phone ? [-2, 3] : [inner, Math.max(inner, first.left - 30)],
    // Pieces follow the writing down the pages and skip the gaps between them.
    rows: units.map((unit, index) => ({
      bottom: index === units.length - 1 ? unit.bottom - 16 : unit.bottom,
      top: index === 0 ? title.top + 16 : unit.top,
    })),
    start: { x: phone ? 8 : first.left - 12, y: middle },
  }
}

// A section's own spots: the same on every visit, a little uneven, spread
// down the writing.
function homes(geometry: Geometry, sectionId: string, phone: boolean): Spot[] {
  const random = seeded(sectionId + (phone ? "phone" : "page"))
  const span = geometry.rows.reduce((sum, row) => sum + Math.max(0, row.bottom - row.top), 0)
  const count = Math.max(6, Math.min(phone ? 9 : POOL, Math.round(span / 56) + 3))
  const [left, right] = geometry.band

  return Array.from({ length: count }, (_, index) => {
    const x = left + random() * (right - left)
    let distance = ((index + 0.5) / count) * span + (random() - 0.5) * (span / count) * 0.4

    for (const row of geometry.rows) {
      const height = Math.max(0, row.bottom - row.top)

      if (distance <= height) {
        return { x, y: row.top + Math.max(0, distance) }
      }

      distance -= height
    }

    return { x, y: geometry.rows.at(-1)?.bottom ?? geometry.start.y }
  })
}

function seeded(text: string): () => number {
  let hash = 2166136261

  for (const character of text) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  }

  return () => {
    hash += 0x6d2b79f5
    let value = hash
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
