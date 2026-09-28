"use client"

import { X } from "lucide-react"
import { type CSSProperties, type ReactElement, type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"

import { CORNERS, FACETS, FLAP, type Point, type Tone } from "@/components/brand/folded-page"

type Rect = { h: number; w: number; x: number; y: number }
type Spot = { x: number; y: number }
type Side = "left" | "right"
type Mode = "closed" | "closing" | "open" | "opening"
type Look = { o: number; s: number; seam: number }

// The button is a swarm of dots, 44px across, that gathers into the sign-in
// page's folded page, 52px tall, on its way to the window. It can be pressed
// a little past its edges.
const PAGE = { h: 52, w: (52 * 360) / 460 }
const REACH = { x: 9, y: 7 }
const SWARM = { count: 110, reach: 22 }
// On its way to and from the window the page is drawn in about this many particles.
const SPECKS = 900
// Under the pointer the swarm hurries.
const HOVER_PACE = 2.2
// A sway eased like a sine wave: two of them a quarter lap apart trace an ellipse.
const SINE = "cubic-bezier(0.37, 0, 0.63, 1)"
// Mostly purples, with a little rose and sage.
const DOT_TONES: readonly Tone[] = ["lavender", "lavender", "lavender", "lavender", "lilac", "lilac", "lilac", "lilac", "wisteria", "wisteria", "wisteria", "orchid", "orchid", "orchid", "periwinkle", "periwinkle", "periwinkle", "rose", "sage"]
const SMALLEST = { h: 380, w: 320 }
const SMALLEST_ON_PHONE = 280
const PHONE = "(width < 48rem)"
const KEPT = "bizflow:flow:"

const middle = (points: readonly Point[]): Point => [
  points.reduce((sum, [x]) => sum + x, 0) / points.length,
  points.reduce((sum, [, y]) => sum + y, 0) / points.length,
]
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))
const between = (low: number, high: number): number => low + Math.random() * (high - low)
const either = (): number => (Math.random() < 0.5 ? -1 : 1)
const smooth = (from: number, to: number, value: number): number => {
  const u = clamp((value - from) / (to - from), 0, 1)

  return u * u * (3 - 2 * u)
}
const easeOut = (q: number): number => 1 - (1 - q) ** 3
const easeInOut = (q: number): number => (q < 0.5 ? 4 * q ** 3 : 1 - (-2 * q + 2) ** 3 / 2)

// Every piece of the page, the fold last, with the way out from the page's middle.
const PIECES = [
  ...FACETS.map((facet) => ({ flap: false, points: facet.corners.map((corner) => CORNERS[corner]), strength: facet.strength, tone: facet.tones[0] })),
  { flap: true, points: [...FLAP], strength: 1, tone: "wisteria" as const },
].map((piece) => {
  const center = middle(piece.points)
  const reach = Math.hypot(center[0], center[1]) || 1

  return { ...piece, center, out: [center[0] / reach, center[1] / reach] as Point }
})
type Dot = {
  // Its orbit seen from the front: an ellipse r across and r * k high, turned by `turn` degrees.
  k: number
  r: number
  turn: number
  // One lap in ms, how far round it starts, and which way round it goes.
  lap: number
  phase: number
  way: number
  // Which half of the orbit comes nearer: there the dot is fuller and a little larger.
  near: number
  size: number
  tone: Tone
  // The piece of the page it gathers into, and where inside that piece.
  piece: number
  spot: readonly [number, number]
}

const AREAS = PIECES.map(({ points: [a, b, c] }) => Math.abs((b![0] - a![0]) * (c![1] - a![1]) - (c![0] - a![0]) * (b![1] - a![1])))

/**
 * Every dot its own orbit, pace and way round. The pieces of the page share
 * out the dots by size, so the page they gather into fills evenly.
 *
 * @returns The swarm.
 */
function makeSwarm(): Dot[] {
  const total = AREAS.reduce((sum, area) => sum + area, 0)

  return Array.from({ length: SWARM.count }, (_, index) => {
    let share = ((index + 0.5) / SWARM.count) * total
    let piece = 0

    while (share > AREAS[piece]! && piece < AREAS.length - 1) share -= AREAS[piece++]!

    const [u, v] = [Math.random(), Math.random()]

    return {
      k: Math.random(),
      lap: (2000 * Math.PI) / between(0.5, 1.3),
      near: either(),
      phase: Math.random(),
      piece,
      r: SWARM.reach * (0.3 + 0.7 * Math.sqrt(Math.random())),
      size: between(1.4, 2.1),
      spot: u + v > 1 ? [1 - u, 1 - v] : [u, v],
      tone: DOT_TONES[Math.floor(Math.random() * DOT_TONES.length)]!,
      turn: between(0, 360),
      way: either(),
    }
  })
}

// How a dot looks from how far down its orbit it has swayed: fuller and larger nearer.
const fullness = (dot: Dot, down: number): { o: number; s: number } => {
  const near = dot.near > 0 ? down : 1 - down

  return { o: 0.3 + 0.7 * near, s: 0.8 + 0.45 * near }
}
// A dot is two boxes: the outer sways across its turned orbit, the inner down it.
const across = (dot: Dot, a: number): { transform: string } => ({
  transform: `rotate(${dot.turn.toFixed(1)}deg) translateX(${(dot.r * (2 * a - 1)).toFixed(2)}px)`,
})
const down = (dot: Dot, d: number): { opacity: number; transform: string } => {
  const { o, s } = fullness(dot, d)

  return { opacity: o, transform: `translateY(${(dot.r * dot.k * (2 * d - 1)).toFixed(2)}px) scale(${s.toFixed(3)})` }
}
// Where its sways start: a quarter lap apart, one way round or the other.
const startOf = (dot: Dot): [number, number] => [
  (1 - Math.cos(2 * Math.PI * dot.phase)) / 2,
  (1 - Math.cos(2 * Math.PI * (dot.phase - dot.way / 4))) / 2,
]
// How far along a sway is, 0 to 1, or where it started when it isn't moving.
const progress = (animation: Animation | undefined, start: number): number => {
  const value = animation?.effect?.getComputedTiming().progress

  return typeof value === "number" ? value : start
}

// Where a dot is about the swarm's middle, and how it looks, from how far along its two sways are.
function pose(dot: Dot, a: number, d: number): { o: number; s: number; x: number; y: number } {
  const x = dot.r * (2 * a - 1)
  const y = dot.r * dot.k * (2 * d - 1)
  const turn = (dot.turn * Math.PI) / 180

  return { ...fullness(dot, d), x: x * Math.cos(turn) - y * Math.sin(turn), y: x * Math.sin(turn) + y * Math.cos(turn) }
}

/**
 * The page as particles: every dot of the swarm and the ones it splits into,
 * spread over the dot's own piece and thickest along the seams, so the facets
 * show while the page travels. Kept in tone order, so drawing seldom swaps colour.
 *
 * @param dots - The swarm.
 * @returns Each particle's dot, piece, size and place in the piece.
 */
function makeSpecks(dots: readonly Dot[]): Array<{ dot: number; own: boolean; piece: number; size: number; spot: readonly [number, number] }> {
  const total = AREAS.reduce((sum, area) => sum + area, 0)

  return PIECES.flatMap((_, piece) => {
    const parents = dots.flatMap((dot, index) => (dot.piece === piece ? [index] : []))

    return Array.from({ length: Math.max(parents.length, Math.round((SPECKS * AREAS[piece]!) / total)) }, (_, n) => {
      const dot = parents[n % parents.length]!

      if (n < parents.length) return { dot, own: true, piece, size: dots[dot]!.size, spot: dots[dot]!.spot }

      // Two in three sit on an edge of the piece: along its first, second or third side.
      const along = Math.random()
      const side = Math.random() < 0.66 ? Math.floor(Math.random() * 3) : -1
      const [u, v] = [Math.random(), Math.random()]
      const spot: [number, number] =
        side === 0 ? [along, 0] : side === 1 ? [0, along] : side === 2 ? [1 - along, along] : u + v > 1 ? [1 - u, 1 - v] : [u, v]

      return { dot, own: false, piece, size: between(1.8, 2.7), spot }
    })
  }).sort((a, b) => dots[a.dot]!.tone.localeCompare(dots[b.dot]!.tone))
}

function read<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(KEPT + key)

    return value ? (JSON.parse(value) as T) : null
  } catch {
    return null
  }
}

function keep(key: string, value: unknown): void {
  try {
    localStorage.setItem(KEPT + key, JSON.stringify(value))
  } catch {
    // A private window keeps nothing; the button still works where it is.
  }
}

/**
 * Where a point of the page lands inside a box: stretched to fill it, except
 * the folded corner, which keeps its own size so a big window keeps a small fold.
 */
function onto(box: Rect, fold = 0): (point: Point) => Point {
  return ([x, y]) => {
    if (fold && x === 90 && y === -230) return [box.x + box.w - fold, box.y]
    if (fold && x === 180 && y === -140) return [box.x + box.w, box.y + fold]
    if (fold && x === 90 && y === -140) return [box.x + box.w - fold, box.y + fold]

    return [box.x + ((x + 180) / 360) * box.w, box.y + ((y + 230) / 460) * box.h]
  }
}

type Parts = {
  dots: readonly Dot[]
  grab: HTMLButtonElement
  head: HTMLElement
  hit: HTMLButtonElement
  outline: SVGPathElement
  phoneBottom: () => number
  pieces: SVGPolygonElement[]
  setMode: (mode: Mode) => void
  shadow: SVGFEDropShadowElement
  specks: HTMLCanvasElement
  swarm: HTMLElement
  toggle: (open: boolean) => void
  win: HTMLElement
}

/**
 * Moves everything the button does. At rest its swarm orbits on its own, in
 * the browser's compositor, so the dots never wait on the page, and it hurries
 * under the pointer. Dragged, the button settles on the nearest side. Pressed,
 * the swarm splits into particles that spread over the folded page as it
 * unfolds, and the page fills in as it lands in the window; shut, the window
 * dissolves into particles as it folds, and they swarm again where the button
 * was left. It works on the elements
 * directly, every frame, and only tells React when the window opens or shuts.
 *
 * @param parts - The swarm, the drawn pieces and dots, the button, the window and its handles.
 * @returns A way to ask for the window open or shut, and to stop.
 */
function animate(parts: Parts): { resize: (event: PointerEvent, zone: HTMLElement) => void; stop: () => void; want: (open: boolean) => void } {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches
  const phoneQuery = matchMedia(PHONE)
  let phone = phoneQuery.matches
  let view = { h: innerHeight, w: innerWidth }
  const safeBottom = readSafeBottom()
  const gap = (): number => (phone ? 14 : 24)
  const floor = (): number => (phone ? parts.phoneBottom() : gap()) + safeBottom
  const clampTop = (top: number): number => clamp(top, phone ? 64 : 72, view.h - PAGE.h - REACH.y - floor())
  const edge = (side: Side): number => (side === "left" ? gap() : view.w - PAGE.w - gap())
  const sideOf = (x: number, width = view.w): Side => (x + PAGE.w / 2 < width / 2 ? "left" : "right")
  const fold = (): number => (phone ? 40 : 34)
  const kept = read<{ side: Side; top: number }>("place")
  let button: Spot = kept ? { x: edge(kept.side), y: clampTop(kept.top) } : { x: edge("right"), y: clampTop(Infinity) }
  let size = read<{ h: number; w: number }>("size") ?? { h: 560, w: 400 }
  let box: Rect = { h: 0, w: 0, x: 0, y: 0 }
  let mode: Mode = "closed"
  let wanted = false
  let trip: { clicked: number; start: number; total: number; unfold: [number, number] } | null = null
  let drag: { id: number; moved: boolean; start: Spot; from: Spot } | null = null
  let glide: { to: Spot; vx: number; vy: number } | null = null
  let moving: { grab: boolean; id: number; moved: boolean; start: Spot; from: Rect } | null = null
  let returnFocus = false
  let swallowClick = false
  let frame = 0
  let last = 0
  let shadowKey = ""
  let bloom = 1
  let heightChange = { frame: 0, to: null as number | null }
  // Each piece takes a new trip, its own way, every time the window opens or shuts.
  const pieces = PIECES.map(() => ({
    at: [] as Point[],
    drawn: { o: "", s: "", seam: "" },
    trip: { angle: 0, blend: 0, bow: 0, delay: 0, dur: 0, part: 0, turn: 0 },
  }))
  // And each particle its own start and pace between the swarm and the page.
  const specks = makeSpecks(parts.dots).map((speck) => ({ ...speck, go: 0, travel: 0 }))
  const tints = new Map<Tone, string>()
  let paint: CanvasRenderingContext2D | null = null
  // Two endless sways per dot, across its orbit and down it. Asked for less
  // motion, or where nothing can animate (a test's page), the swarm holds still where it starts.
  const motion =
    still || typeof parts.swarm.animate !== "function"
      ? []
      : parts.dots.flatMap((dot, index) => {
          const sway = parts.swarm.children[index]!
          const timing = { direction: "alternate", duration: dot.lap / 2, easing: SINE, iterations: Infinity } as const

          return [
            sway.animate([across(dot, 0), across(dot, 1)], { ...timing, delay: -dot.phase * dot.lap }),
            sway.firstElementChild!.animate([down(dot, 0), down(dot, 1)], { ...timing, delay: -(dot.phase - dot.way / 4 + 1) * dot.lap }),
          ]
        })
  const pace = (rate: number): void => {
    for (const animation of motion) animation.updatePlaybackRate(rate)
  }

  const buttonBox = (): Rect => ({ ...button, h: PAGE.h, w: PAGE.w })
  const shape = (index: number, where: "button" | "window"): Point[] =>
    PIECES[index]!.points.map(where === "button" ? onto(buttonBox()) : onto(box, fold()))
  // In the window the page goes pale and seamless; its fold stays, as the way to close.
  const settled = (index: number): Look => (PIECES[index]!.flap ? { o: 1, s: 1, seam: 1 } : { o: 1, s: 0.24, seam: 0 })
  const kick = (): void => {
    frame ||= requestAnimationFrame(draw)
  }
  // Where a dot of the swarm is on screen right now, and how it looks.
  const home = (index: number): { o: number; s: number; x: number; y: number } => {
    const dot = parts.dots[index]!
    const [a, d] = startOf(dot)
    const at = pose(dot, progress(motion[index * 2], a), progress(motion[index * 2 + 1], d))

    return { ...at, x: button.x + PAGE.w / 2 + at.x * bloom, y: button.y + PAGE.h / 2 + at.y * bloom }
  }

  function place(): void {
    parts.hit.style.transform = `translate(${button.x - REACH.x}px, ${button.y - REACH.y}px)`
    Object.assign(parts.win.style, { height: `${box.h}px`, left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px` })
  }

  function windowBox(): Rect {
    if (phone) {
      const h = clamp(read<number>("phone-height") ?? Math.round(view.h * 0.82), SMALLEST_ON_PHONE, view.h - 16)

      return { h, w: view.w - 16, x: 8, y: view.h - h - 8 - safeBottom }
    }

    const w = clamp(size.w, SMALLEST.w, view.w - 24)
    const h = clamp(size.h, SMALLEST.h, view.h - 24)
    // It grows out of the button: the button's corner stays where it is.
    const x = sideOf(button.x) === "right" ? button.x + PAGE.w - w : button.x
    const y = button.y + PAGE.h / 2 > view.h / 2 ? button.y + PAGE.h - h : button.y

    return { h, w, x: clamp(x, 12, view.w - w - 12), y: clamp(y, 12, view.h - h - 12) }
  }

  function begin(next: "closing" | "opening"): void {
    const now = performance.now()
    const opening = next === "opening"
    const landing = ({ delay, dur }: { delay: number; dur: number }): number => delay + dur
    mode = next

    for (const piece of pieces) {
      piece.trip = {
        angle: between(-0.5, 0.5),
        blend: between(0.25, 0.85),
        bow: either() * between(10, 34),
        delay: between(0, 110),
        dur: between(430, 600),
        part: between(6, 18),
        turn: either() * between(6, 18),
      }
    }

    // On the way the page is particles. Opening, the swarm splits and spreads
    // over the pieces as they unfold, and the page fills in only as it lands;
    // closing, the page dissolves into them as it folds, and they swarm home.
    for (const speck of specks) {
      const { delay, dur } = pieces[speck.piece]!.trip

      Object.assign(
        speck,
        opening
          ? { go: Math.max(0, delay + between(-0.05, 0.12) * dur), travel: between(240, 380) }
          : { go: delay + between(0.45, 0.62) * dur, travel: between(280, 420) }
      )
    }

    const trips = pieces.map((piece) => piece.trip)
    const folded = Math.max(...trips.map(landing))
    trip = {
      clicked: now,
      start: now + (opening ? 0 : 90) - (still ? 1e6 : 0),
      total: Math.max(folded, ...specks.map(({ go, travel }) => go + travel)),
      // While the page itself unfolds or folds: the window's fade, edge and lift follow it.
      unfold: [opening ? Math.min(...trips.map((piece) => piece.delay)) : 0, folded],
    }
    // From the swarm as it is this instant, grown under the pointer or not.
    bloom = opening ? parseFloat(getComputedStyle(parts.swarm).scale) || 1 : 1
    pace(1)
    parts.hit.hidden = true
    showSpecks()
    parts.setMode(next)
    kick()
  }

  // The particles' canvas, sized to the screen, with the swarm's tones as it needs them.
  function showSpecks(): void {
    paint ??= still ? null : parts.specks.getContext("2d")

    if (!paint) return

    const dpr = devicePixelRatio || 1
    parts.specks.width = Math.round(view.w * dpr)
    parts.specks.height = Math.round(view.h * dpr)
    paint.setTransform(dpr, 0, 0, dpr, 0, 0)

    for (const tone of new Set(DOT_TONES)) {
      parts.specks.style.color = DOT_FILL(tone)
      tints.set(tone, getComputedStyle(parts.specks).color)
    }

    parts.specks.hidden = false
  }

  function want(open: boolean): void {
    wanted = open

    if (open && mode === "closed") {
      box = windowBox()
      glide = null
      parts.win.style.opacity = "0"
      place()
      begin("opening")
    } else if (!open && mode === "open") {
      returnFocus ||= parts.win.contains(document.activeElement)
      begin("closing")
    }
  }

  function finish(): void {
    const closed = mode === "closing"
    trip = null
    mode = closed ? "closed" : "open"
    parts.setMode(mode)
    // Swapped at once, not when React next draws, so nothing blinks between the dots and the swarm.
    parts.hit.hidden = !closed
    parts.specks.hidden = true
    parts.win.style.opacity = closed ? "0" : "1"
    parts.win.style.transform = ""

    if (closed && returnFocus) {
      returnFocus = false
      parts.hit.focus({ preventScroll: true })
    } else if (!closed && !phone) {
      parts.win.querySelector<HTMLElement>("textarea, input")?.focus({ preventScroll: true })
    }

    // Asked the other way while it moved: now it goes.
    if (wanted !== !closed) {
      want(wanted)
    }
  }

  function moveTo(x: number, y: number): void {
    button = { x, y }
    place()
  }

  function settleOnSide(): void {
    const to = { x: edge(sideOf(button.x)), y: clampTop(button.y) }

    if (still) {
      moveTo(to.x, to.y)
      keep("place", { side: sideOf(button.x), top: button.y })
    } else {
      glide = { to, vx: 0, vy: 0 }
      kick()
    }
  }

  function stepGlide(dt: number): boolean {
    if (!glide) return false

    glide.vx += (170 * (glide.to.x - button.x) - 24 * glide.vx) * dt
    glide.vy += (170 * (glide.to.y - button.y) - 24 * glide.vy) * dt
    const x = button.x + glide.vx * dt
    const y = button.y + glide.vy * dt

    if (Math.abs(glide.to.x - x) + Math.abs(glide.to.y - y) < 0.3 && Math.abs(glide.vx) + Math.abs(glide.vy) < 6) {
      moveTo(glide.to.x, glide.to.y)
      glide = null
      keep("place", { side: sideOf(button.x), top: button.y })

      return false
    }

    moveTo(x, y)

    return true
  }

  function drawPiece(index: number, points: Point[], dx: number, dy: number, turn: number, look: Look): void {
    const piece = pieces[index]!
    const [cx, cy] = middle(points)
    const cos = Math.cos((turn * Math.PI) / 180)
    const sin = Math.sin((turn * Math.PI) / 180)
    const turned = points.map(([x, y]): Point => [cx + (x - cx) * cos - (y - cy) * sin + dx, cy + (x - cx) * sin + (y - cy) * cos + dy])
    // A piece in flight never leaves the screen: it is nudged back inside whole.
    const xs = turned.map(([x]) => x)
    const ys = turned.map(([, y]) => y)
    const nx = Math.max(0, 2 - Math.min(...xs)) + Math.min(0, view.w - 2 - Math.max(...xs))
    const ny = Math.max(0, 2 - Math.min(...ys)) + Math.min(0, view.h - 2 - Math.max(...ys))
    const element = parts.pieces[index]!
    const o = look.o.toFixed(3)
    const s = look.s.toFixed(3)
    const seam = look.seam.toFixed(3)

    piece.at = turned.map(([x, y]): Point => [x + nx, y + ny])
    element.setAttribute("points", piece.at.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" "))

    if (piece.drawn.o !== o) element.style.opacity = piece.drawn.o = o
    if (piece.drawn.s !== s) element.style.setProperty("--s", (piece.drawn.s = s))
    if (piece.drawn.seam !== seam) element.style.setProperty("--seam", (piece.drawn.seam = seam))
  }

  // The page as particles, on its way between the swarm and the window.
  function drawSpecks(t: number): void {
    if (!paint) return

    const opening = mode === "opening"
    const homes = parts.dots.map((_, index) => home(index))
    let tint = ""
    paint.clearRect(0, 0, view.w, view.h)

    for (const speck of specks) {
      const piece = pieces[speck.piece]!
      const [a, b, c] = piece.at as [Point, Point, Point]
      const [u, v] = speck.spot
      const out = homes[speck.dot]!
      // How far onto the page: 1 is on its piece, 0 back in the swarm.
      const e = easeInOut(clamp((t - speck.go) / speck.travel, 0, 1))
      const k = opening ? e : 1 - e
      const q = clamp((t - piece.trip.delay) / piece.trip.dur, 0, 1)
      // Particles give way to the page as it fills in at the window, and take over as it dissolves.
      const page = opening ? 1 - smooth(0.8, 1, q) : smooth(0, 0.3, q)
      // One split from a dot shows only once it is clear of that dot.
      const alpha = (out.o + (1 - out.o) * k) * page * (speck.own ? 1 : smooth(0, 0.35, k))

      if (alpha < 0.01) continue

      const color = tints.get(parts.dots[speck.dot]!.tone)!

      if (color !== tint) paint.fillStyle = tint = color

      paint.globalAlpha = alpha
      paint.beginPath()
      paint.arc(
        out.x + (a[0] + u * (b[0] - a[0]) + v * (c[0] - a[0]) - out.x) * k,
        out.y + (a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]) - out.y) * k,
        (speck.size / 2) * (speck.own ? bloom * (out.s + (1 - out.s) * k) : 1),
        0,
        2 * Math.PI
      )
      paint.fill()
    }
  }

  function draw(now: number): void {
    frame = 0
    const dt = Math.min(0.032, last ? (now - last) / 1000 : 0.016)
    last = now
    const again = stepGlide(dt)
    const t = trip ? now - trip.start : 0
    const [from, to] = trip?.unfold ?? [0, 1]
    const T = clamp((t - from) / (to - from), 0, 1)

    // At rest the swarm is the button: the page is drawn only on its way to the window, and in it.
    if (mode !== "closed") {
      pieces.forEach((piece, index) => {
        let points: Point[]
        let look: Look
        let ex = 0
        let ey = 0
        let er = 0

        if (mode === "open") {
          points = shape(index, "window")
          look = settled(index)
        } else {
          const opening = mode === "opening"
          const q = clamp((t - piece.trip.delay) / piece.trip.dur, 0, 1)
          const e = piece.trip.blend * easeInOut(q) + (1 - piece.trip.blend) * easeOut(q)
          const a = shape(index, opening ? "button" : "window")
          const b = shape(index, opening ? "window" : "button")
          points = a.map(([x, y], n): Point => [x + (b[n]![0] - x) * e, y + (b[n]![1] - y) * e])
          // Mid-flight it parts from the others, bows off a straight line and turns, its own way.
          const bump = Math.sin(Math.PI * q)
          const [ox0, oy0] = PIECES[index]!.out
          const ox = ox0 * Math.cos(piece.trip.angle) - oy0 * Math.sin(piece.trip.angle)
          const oy = ox0 * Math.sin(piece.trip.angle) + oy0 * Math.cos(piece.trip.angle)
          const [ax, ay] = middle(a)
          const [bx, by] = middle(b)
          const length = Math.hypot(bx - ax, by - ay) || 1
          ex = ox * piece.trip.part * bump - ((by - ay) / length) * piece.trip.bow * bump
          ey = oy * piece.trip.part * bump + ((bx - ax) / length) * piece.trip.bow * bump
          er = piece.trip.turn * bump
          const rest = settled(index)
          const k = opening ? smooth(0.45, 1, q) : 1 - smooth(0, 0.55, q)
          // The page itself shows only at the window: on the way it is particles.
          look = { o: opening ? smooth(0.75, 1, q) : 1 - smooth(0, 0.3, q), s: 1 + (rest.s - 1) * k, seam: 1 + (rest.seam - 1) * k }
        }

        drawPiece(index, points, ex, ey, er, look)
      })
    }

    if (mode === "opening" || mode === "closing") {
      drawSpecks(t)
    }

    if (mode !== "closed") {
      const shown = mode === "opening" ? smooth(0.62, 0.97, T) : mode === "closing" ? 1 - smooth(0, 150, now - (trip?.clicked ?? now)) : 1
      parts.win.style.opacity = String(shown)
      parts.win.style.transform = mode === "opening" ? `translateY(${((1 - shown) * 6).toFixed(2)}px)` : ""
    }

    // The window's own edge, once the pieces have become it.
    const rim = mode === "open" ? 1 : mode === "opening" ? smooth(0.85, 1, T) : mode === "closing" ? 1 - smooth(0, 0.15, T) : 0
    parts.outline.style.opacity = String(rim)

    if (rim) {
      const outline = (["tl", "p1", "p2", "p3", "p4"] as const).map((corner) => onto(box, fold())(CORNERS[corner]))
      parts.outline.setAttribute("d", `M${outline.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L")} Z`)
    }

    // The page's lift, which grows into the window's as the pieces become it.
    const k = mode === "open" ? 1 : mode === "opening" ? easeInOut(T) : mode === "closing" ? 1 - easeInOut(T) : 0
    const dark = document.documentElement.classList.contains("dark") ? 2.4 : 1
    const lift = [5 + 13 * k, 4.5 + 15.5 * k, Math.min(0.6, (0.22 - 0.06 * k) * dark)]
    const key = lift.map((value) => value.toFixed(2)).join()

    if (key !== shadowKey) {
      shadowKey = key
      parts.shadow.setAttribute("dy", lift[0]!.toFixed(2))
      parts.shadow.setAttribute("stdDeviation", lift[1]!.toFixed(2))
      parts.shadow.setAttribute("flood-opacity", lift[2]!.toFixed(3))
    }

    if (trip && t >= trip.total) {
      finish()
    }

    if (trip || again || glide) {
      kick()
    }
  }

  // Phone: the top bar and its grab bar set the height; a tap on the bar
  // switches between half and nearly full, and arrow keys step it.
  function setPhoneHeight(target: number): void {
    cancelAnimationFrame(heightChange.frame)
    const from = box.h
    const to = clamp(target, SMALLEST_ON_PHONE, view.h - 16)
    const start = performance.now()
    const step = (now: number): void => {
      const q = still ? 1 : Math.min(1, (now - start) / 220)
      const h = from + (to - from) * easeOut(q)
      box = { ...box, h, y: view.h - h - 8 - safeBottom }
      place()
      kick()

      if (q < 1) {
        heightChange.frame = requestAnimationFrame(step)
      } else {
        heightChange = { frame: 0, to: null }
        keep("phone-height", Math.round(to))
      }
    }
    heightChange = { frame: requestAnimationFrame(step), to }
  }

  function toggleHeight(): void {
    const tall = Math.round(view.h * 0.88)
    const half = Math.round(view.h * 0.5)
    setPhoneHeight(box.h < (tall + half) / 2 ? tall : half)
  }

  // Under the pointer the swarm hurries; a touch only presses.
  const onHitEnter = (event: PointerEvent): void => {
    if (event.pointerType !== "touch" && mode === "closed") pace(HOVER_PACE)
  }
  const onHitLeave = (): void => pace(1)
  const onHitDown = (event: PointerEvent): void => {
    swallowClick = false

    if (mode !== "closed" || event.button !== 0) return

    parts.hit.setPointerCapture?.(event.pointerId)
    drag = { from: { ...button }, id: event.pointerId, moved: false, start: { x: event.clientX, y: event.clientY } }
    glide = null
  }
  const onHitMove = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.id) return

    const dx = event.clientX - drag.start.x
    const dy = event.clientY - drag.start.y

    if (!drag.moved && Math.hypot(dx, dy) < 5) return

    drag.moved = true
    moveTo(clamp(drag.from.x + dx, 4, view.w - PAGE.w - 4), clamp(drag.from.y + dy, 4, view.h - PAGE.h - 4))
  }
  const onHitUp = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.id) return

    if (drag.moved) {
      swallowClick = true
      settleOnSide()
    }

    drag = null
  }
  const onHitClick = (): void => {
    if (swallowClick) {
      swallowClick = false
      return
    }

    parts.toggle(true)
  }
  const onKey = (event: KeyboardEvent): void => {
    const focus = document.activeElement

    // Also while it is still unfolding: it finishes, then folds straight back.
    if (event.key === "Escape" && (mode === "open" || mode === "opening") && (parts.win.contains(focus) || focus === document.body || focus === null)) {
      event.preventDefault()
      returnFocus = true
      parts.toggle(false)
    }
  }
  const onGrabKey = (event: KeyboardEvent): void => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault()
      setPhoneHeight((heightChange.to ?? box.h) + (event.key === "ArrowUp" ? 48 : -48))
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      toggleHeight()
    }
  }
  // Desktop: the top bar moves the window.
  const onHeadDown = (event: PointerEvent): void => {
    const target = event.target as Element
    const grab = parts.grab.contains(target)

    if (mode !== "open" || event.button !== 0 || (target.closest("button") && !grab)) return

    parts.head.setPointerCapture?.(event.pointerId)
    moving = { from: { ...box }, grab, id: event.pointerId, moved: false, start: { x: event.clientX, y: event.clientY } }
    parts.head.dataset.moving = ""
  }
  const onHeadMove = (event: PointerEvent): void => {
    if (!moving || event.pointerId !== moving.id) return

    const dx = event.clientX - moving.start.x
    const dy = event.clientY - moving.start.y

    if (!moving.moved && Math.hypot(dx, dy) < 4) return

    moving.moved = true
    box = phone
      ? { ...box, h: clamp(moving.from.h - dy, SMALLEST_ON_PHONE, view.h - 16), y: 0 }
      : { ...box, x: clamp(moving.from.x + dx, 8, view.w - box.w - 8), y: clamp(moving.from.y + dy, 8, view.h - box.h - 8) }

    if (phone) box.y = view.h - box.h - 8 - safeBottom

    place()
    kick()
  }
  const onHeadUp = (event: PointerEvent): void => {
    if (!moving || event.pointerId !== moving.id) return

    if (phone && moving.grab && !moving.moved) toggleHeight()
    else if (phone && moving.moved) keep("phone-height", Math.round(box.h))

    moving = null
    delete parts.head.dataset.moving
  }
  const resize = (event: PointerEvent, zone: HTMLElement): void => {
    if (mode !== "open" || phone || event.button !== 0) return

    event.preventDefault()
    zone.setPointerCapture?.(event.pointerId)
    const from = { ...box }
    const side = zone.dataset.edge ?? ""
    const follow = (move: PointerEvent): void => {
      const dx = move.clientX - event.clientX
      const dy = move.clientY - event.clientY
      const w = clamp(side.includes("e") ? from.w + dx : side.includes("w") ? from.w - dx : from.w, SMALLEST.w, view.w - 16)
      const h = clamp(side.includes("s") ? from.h + dy : side.includes("n") ? from.h - dy : from.h, SMALLEST.h, view.h - 16)
      box = {
        h,
        w,
        x: clamp(side.includes("w") ? from.x + from.w - w : from.x, 8, view.w - w - 8),
        y: clamp(side.includes("n") ? from.y + from.h - h : from.y, 8, view.h - h - 8),
      }
      place()
      kick()
    }
    const done = (): void => {
      zone.removeEventListener("pointermove", follow)
      zone.removeEventListener("pointerup", done)
      zone.removeEventListener("pointercancel", done)
      size = { h: box.h, w: box.w }
      keep("size", size)
    }

    zone.addEventListener("pointermove", follow)
    zone.addEventListener("pointerup", done)
    zone.addEventListener("pointercancel", done)
  }
  const onResize = (): void => {
    const side = sideOf(button.x, view.w)
    view = { h: innerHeight, w: innerWidth }
    phone = phoneQuery.matches
    button = { x: edge(side), y: clampTop(button.y) }

    if (mode !== "closed") {
      box = phone ? windowBox() : { ...box, h: Math.min(box.h, view.h - 24), w: Math.min(box.w, view.w - 24) }
      box.x = clamp(box.x, 8, Math.max(8, view.w - box.w - 8))
      box.y = clamp(box.y, 8, Math.max(8, view.h - box.h - 8))
    }

    place()
    kick()
  }

  const listeners: Array<[EventTarget, string, EventListener]> = [
    [parts.hit, "pointerenter", onHitEnter as EventListener],
    [parts.hit, "pointerleave", onHitLeave],
    [parts.hit, "pointerdown", onHitDown as EventListener],
    [parts.hit, "pointermove", onHitMove as EventListener],
    [parts.hit, "pointerup", onHitUp as EventListener],
    [parts.hit, "pointercancel", onHitUp as EventListener],
    [parts.hit, "click", onHitClick],
    [window, "keydown", onKey as EventListener],
    [parts.grab, "keydown", onGrabKey as EventListener],
    [parts.head, "pointerdown", onHeadDown as EventListener],
    [parts.head, "pointermove", onHeadMove as EventListener],
    [parts.head, "pointerup", onHeadUp as EventListener],
    [parts.head, "pointercancel", onHeadUp as EventListener],
    [window, "resize", onResize],
  ]

  listeners.forEach(([target, type, listener]) => target.addEventListener(type, listener))
  place()
  kick()

  return {
    stop() {
      for (const animation of motion) animation.cancel()
      cancelAnimationFrame(frame)
      cancelAnimationFrame(heightChange.frame)
      listeners.forEach(([target, type, listener]) => target.removeEventListener(type, listener))
    },
    resize,
    want,
  }
}

const subscribeNever = (): (() => void) => () => undefined

function subscribeToPhone(onChange: () => void): () => void {
  const query = matchMedia(PHONE)
  query.addEventListener("change", onChange)

  return () => query.removeEventListener("change", onChange)
}

// How much of the bottom a phone keeps for its home bar.
function readSafeBottom(): number {
  const probe = document.createElement("div")
  probe.style.cssText = "position:fixed;bottom:0;height:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none"
  document.body.append(probe)
  const height = probe.offsetHeight
  probe.remove()

  return height
}

const PIECE_STYLE = (tone: string, strength: number): CSSProperties =>
  ({
    fill: `color-mix(in oklch, var(--fold-${tone}) calc(var(--s, 1) * ${strength} * var(--fold-strength) * 100%), var(--popover))`,
    stroke: "var(--fold-seam)",
    strokeLinejoin: "round",
    strokeOpacity: "var(--seam, 1)",
    strokeWidth: 0.8,
  }) as CSSProperties

// The page's own tones, deepened toward plum by day so a dot this small still reads.
const DOT_MIX = "[--flow-dot:55%] dark:[--flow-dot:100%]"
const DOT_FILL = (tone: Tone): string => `color-mix(in oklch, var(--fold-${tone}) var(--flow-dot), var(--primary))`

// Whatever scrolls inside does it without showing a bar.
const QUIET_SCROLL = "[&_*]:[scrollbar-width:none] [&_*::-webkit-scrollbar]:hidden"

/**
 * Flow's button and window. The button is a swarm of dots, each always on an
 * orbit of its own, that hurries under the pointer, drags anywhere, settles on
 * the nearest side and stays where it was left. Pressed, the swarm spreads
 * into BizFlow's folded page, drawn in particles as it unfolds, and fills in as
 * a window shaped like the page. It moves by its top bar, resizes from any
 * edge, and from its folded corner or with Escape dissolves back into
 * particles as it folds, which swarm again.
 * On a phone the window is a sheet with a grab bar that sets its height. What
 * Flow says lives inside, and stays mounted while the window is shut.
 *
 * @param props - What Flow shows, whether it is open, and how high the button rests above a phone's tab bar.
 * @returns The button and the window, drawn over the page.
 */
export function FlowWindow({
  children,
  onOpenChange,
  open,
  phoneBottom = 16,
  title = "Flow",
}: {
  children: ReactNode
  onOpenChange: (open: boolean) => void
  open: boolean
  phoneBottom?: number
  title?: string
}): ReactElement | null {
  // Drawn only in the browser, over everything, once the page has hydrated.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false)
  const [mode, setMode] = useState<Mode>("closed")
  const [dots] = useState(makeSwarm)
  const phone = useSyncExternalStore(subscribeToPhone, () => matchMedia(PHONE).matches, () => false)
  const titleId = useId()
  const windowId = useId()
  const shadowId = useId()
  const pieces = useRef<SVGPolygonElement[]>([])
  const specks = useRef<HTMLCanvasElement>(null)
  const swarm = useRef<HTMLSpanElement>(null)
  const outline = useRef<SVGPathElement>(null)
  const shadow = useRef<SVGFEDropShadowElement>(null)
  const hit = useRef<HTMLButtonElement>(null)
  const win = useRef<HTMLElement>(null)
  const head = useRef<HTMLElement>(null)
  const grab = useRef<HTMLButtonElement>(null)
  const engine = useRef<ReturnType<typeof animate> | null>(null)
  const latest = useRef({ onOpenChange, phoneBottom })

  useEffect(() => {
    latest.current = { onOpenChange, phoneBottom }
  })

  useEffect(() => {
    if (!mounted || !grab.current || !head.current || !hit.current || !outline.current || !shadow.current || !specks.current || !swarm.current || !win.current) {
      return undefined
    }

    const running = animate({
      dots,
      grab: grab.current,
      head: head.current,
      hit: hit.current,
      outline: outline.current,
      phoneBottom: () => latest.current.phoneBottom,
      pieces: pieces.current,
      setMode,
      shadow: shadow.current,
      specks: specks.current,
      swarm: swarm.current,
      toggle: (next) => latest.current.onOpenChange(next),
      win: win.current,
    })
    engine.current = running

    return () => {
      engine.current = null
      running.stop()
    }
  }, [dots, mounted])

  useEffect(() => {
    engine.current?.want(open)
  }, [mounted, open])

  if (!mounted) {
    return null
  }

  return createPortal(
    <>
      <svg aria-hidden="true" className="pointer-events-none fixed inset-0 z-40 size-full overflow-visible" data-slot="flow-pieces">
        <defs>
          <filter colorInterpolationFilters="sRGB" height="180%" id={shadowId} width="180%" x="-40%" y="-40%">
            <feDropShadow dx="0" dy="5" floodColor="black" floodOpacity="0.22" ref={shadow} stdDeviation="4.5" />
          </filter>
        </defs>
        <g filter={`url(#${shadowId})`}>
          {PIECES.map((piece, index) => (
            <polygon
              key={index}
              ref={(element) => {
                if (element) pieces.current[index] = element
              }}
              style={{ ...PIECE_STYLE(piece.tone, piece.strength), opacity: 0 }}
            />
          ))}
        </g>
        <path fill="none" opacity={0} ref={outline} strokeLinejoin="round" style={{ stroke: "var(--border)" }} />
      </svg>
      {/* The page as particles while it travels between the swarm and the window. */}
      <canvas aria-hidden="true" className={`pointer-events-none fixed inset-0 z-40 size-full ${DOT_MIX}`} hidden ref={specks} />
      <section
        aria-labelledby={titleId}
        className="fixed z-40 flex flex-col text-popover-foreground"
        data-slot="flow-window"
        hidden={mode === "closed"}
        id={windowId}
        ref={win}
        role="dialog"
      >
        <header
          className="relative flex h-13 shrink-0 cursor-grab touch-none items-center gap-2.5 px-[18px] select-none data-moving:cursor-grabbing max-md:cursor-ns-resize"
          ref={head}
        >
          <button
            aria-label={`Resize ${title}`}
            className="absolute top-0 left-1/2 hidden h-6 w-18 -translate-x-1/2 cursor-ns-resize touch-none rounded-[12px] outline-none before:absolute before:top-[7px] before:left-4 before:h-[5px] before:w-10 before:rounded-full before:bg-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring/40 max-md:block"
            ref={grab}
            title="Drag or tap to resize"
            type="button"
          />
          <h2 className="text-[15px] font-semibold" id={titleId}>
            {title}
          </h2>
          {/* The page's folded corner is the way to close it. */}
          <button
            aria-label={`Close ${title}`}
            className="absolute top-0 right-0 size-[34px] text-secondary-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 max-md:size-10"
            onClick={() => latest.current.onOpenChange(false)}
            type="button"
          >
            <X aria-hidden="true" className="absolute top-[calc(70%-6px)] left-[calc(30%-6px)] size-3 stroke-2" />
          </button>
        </header>
        <div className={`flex min-h-0 flex-1 flex-col ${QUIET_SCROLL}`}>{children}</div>
        {!phone
          ? (["n", "s", "e", "w", "nw", "sw", "se"] as const).map((edge) => (
              <div
                aria-hidden="true"
                className={EDGE_CLASS[edge]}
                data-edge={edge}
                key={edge}
                onPointerDown={(event) => engine.current?.resize(event.nativeEvent, event.currentTarget)}
              />
            ))
          : null}
      </section>
      <button
        aria-controls={windowId}
        aria-haspopup="dialog"
        aria-label={title}
        className="group fixed top-0 left-0 z-40 cursor-pointer touch-none rounded-[12px] outline-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-ring/40"
        data-slot="flow-launcher"
        hidden={mode !== "closed"}
        ref={hit}
        style={{ height: PAGE.h + REACH.y * 2, width: PAGE.w + REACH.x * 2 }}
        type="button"
      >
        {/* About the button's middle; each dot is two boxes, one swaying across its orbit, one down it. */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute top-1/2 left-1/2 transition-[scale] duration-300 ease-out group-hover:scale-108 ${DOT_MIX}`}
          data-slot="flow-swarm"
          ref={swarm}
        >
          {dots.map((dot, index) => {
            const [a, d] = startOf(dot)

            return (
              <span className="absolute" key={index} style={across(dot, a)}>
                <span
                  className="absolute rounded-full"
                  style={{ ...down(dot, d), background: DOT_FILL(dot.tone), height: dot.size, left: -dot.size / 2, top: -dot.size / 2, width: dot.size }}
                />
              </span>
            )
          })}
        </span>
      </button>
    </>,
    document.body
  )
}

// Where a window edge can be pulled from; the folded corner is not one.
const EDGE_CLASS = {
  e: "absolute top-3.5 -right-1 bottom-3.5 w-2 cursor-ew-resize touch-none",
  n: "absolute -top-1 right-10 left-3.5 h-2 cursor-ns-resize touch-none",
  nw: "absolute -top-1 -left-1 size-4 cursor-nwse-resize touch-none",
  s: "absolute right-3.5 -bottom-1 left-3.5 h-2 cursor-ns-resize touch-none",
  se: "absolute -right-1 -bottom-1 size-4 cursor-nwse-resize touch-none",
  sw: "absolute -bottom-1 -left-1 size-4 cursor-nesw-resize touch-none",
  w: "absolute top-3.5 bottom-3.5 -left-1 w-2 cursor-ew-resize touch-none",
} as const
