"use client"

import { X } from "lucide-react"
import { type CSSProperties, type ReactElement, type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"

import { CORNERS, FACETS, FLAP, type Point, WAVES } from "@/components/brand/folded-page"

type Rect = { h: number; w: number; x: number; y: number }
type Spot = { x: number; y: number }
type Side = "left" | "right"
type Mode = "closed" | "closing" | "open" | "opening"
type Look = { s: number; seam: number }

// The button is the sign-in page's folded page, 52px tall, and can be pressed
// a little past its edges.
const PAGE = { h: 52, w: (52 * 360) / 460 }
const REACH = { x: 9, y: 7 }
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
// Each line across the page moves with the piece nearest its middle.
const WAVE_HOSTS = WAVES.map((y) =>
  PIECES.reduce((best, piece, index) =>
    Math.hypot(piece.center[0], piece.center[1] - y) < Math.hypot(PIECES[best]!.center[0], PIECES[best]!.center[1] - y) ? index : best, 0)
)

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
  grab: HTMLButtonElement
  head: HTMLElement
  hit: HTMLButtonElement
  outline: SVGPathElement
  phoneBottom: () => number
  pieces: SVGPolygonElement[]
  setMode: (mode: Mode) => void
  shadow: SVGFEDropShadowElement
  toggle: (open: boolean) => void
  waves: SVGPathElement[]
  win: HTMLElement
}

/**
 * Moves everything the page does: the pieces parting under the pointer,
 * trailing a drag and settling on the nearest side, unfolding into the window
 * and folding back to where the button was left. It works on the elements
 * directly, every frame, and only tells React when the window opens or shuts.
 *
 * @param parts - The drawn pieces, the button, the window and its handles.
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
  let trip: { clicked: number; start: number; total: number } | null = null
  let pointer: Spot | null = null
  let drag: { id: number; moved: boolean; start: Spot; from: Spot } | null = null
  let glide: { to: Spot; vx: number; vy: number } | null = null
  let moving: { grab: boolean; id: number; moved: boolean; start: Spot; from: Rect } | null = null
  let returnFocus = false
  let swallowClick = false
  let frame = 0
  let last = 0
  let shadowKey = ""
  let heightChange = { frame: 0, to: null as number | null }
  // Each piece has ways of its own: how firmly it springs back, which way it
  // turns, how far it trails, and a new trip every time the window opens or shuts.
  const pieces = PIECES.map(() => ({
    damp: between(15, 22),
    drawn: { s: "", seam: "" },
    goal: { r: 0, x: 0, y: 0 },
    lag: between(0.25, 0.65),
    look: { s: 1, seam: 1 } as Look,
    off: { r: 0, vr: 0, vx: 0, vy: 0, x: 0, y: 0 },
    spin: either() * between(0.8, 1.6),
    stiff: between(150, 260),
    trip: { angle: 0, blend: 0, bow: 0, delay: 0, dur: 0, part: 0, turn: 0 },
  }))

  const buttonBox = (): Rect => ({ ...button, h: PAGE.h, w: PAGE.w })
  const shape = (index: number, where: "button" | "window"): Point[] =>
    PIECES[index]!.points.map(where === "button" ? onto(buttonBox()) : onto(box, fold()))
  // In the window the page goes pale and seamless; its fold stays, as the way to close.
  const settled = (index: number): Look => (PIECES[index]!.flap ? { s: 1, seam: 1 } : { s: 0.24, seam: 0 })
  const kick = (): void => {
    frame ||= requestAnimationFrame(draw)
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

    trip = { clicked: now, start: now + (next === "closing" ? 90 : 0), total: 0 }
    trip.total = Math.max(...pieces.map((piece) => piece.trip.delay + piece.trip.dur))

    if (still) {
      trip.start -= 1e6
    }

    parts.setMode(next)
    kick()
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
    const dx = x - button.x
    const dy = y - button.y
    button = { x, y }

    // The page is made of pieces: each trails the move by its own amount.
    for (const piece of pieces) {
      piece.off.x = clamp(piece.off.x - dx * piece.lag, -12, 12)
      piece.off.y = clamp(piece.off.y - dy * piece.lag, -12, 12)
      piece.off.r = clamp(piece.off.r - dx * piece.lag * piece.spin * 0.4, -14, 14)
    }

    place()
    kick()
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

  // Near the pointer the pieces part a little, each turning its own way.
  function aimHover(): void {
    const reach = buttonBox()
    const on =
      !still &&
      mode === "closed" &&
      pointer !== null &&
      !drag?.moved &&
      Math.hypot(pointer.x - reach.x - PAGE.w / 2, pointer.y - reach.y - PAGE.h / 2) < 50
    const map = onto(reach)

    pieces.forEach((piece, index) => {
      if (!on || !pointer) {
        piece.goal = { r: 0, x: 0, y: 0 }
        return
      }

      const [x, y] = map(PIECES[index]!.center)
      let dx = x - pointer.x
      let dy = y - pointer.y
      let distance = Math.hypot(dx, dy)

      if (distance < 1.5) {
        ;[dx, dy, distance] = [PIECES[index]!.out[0], PIECES[index]!.out[1], 1]
      }

      const push = 2.6 * Math.exp(-(distance * distance) / 162)
      piece.goal = { r: piece.spin * push * 1.1, x: (dx / distance) * push, y: (dy / distance) * push }
    })
  }

  function stepSprings(dt: number): boolean {
    let busy = false

    for (const piece of pieces) {
      const { goal, off } = piece
      off.vx += (piece.stiff * (goal.x - off.x) - piece.damp * off.vx) * dt
      off.vy += (piece.stiff * (goal.y - off.y) - piece.damp * off.vy) * dt
      off.vr += (piece.stiff * (goal.r - off.r) - piece.damp * off.vr) * dt
      off.x += off.vx * dt
      off.y += off.vy * dt
      off.r += off.vr * dt
      busy ||= Math.abs(goal.x - off.x) + Math.abs(goal.y - off.y) + Math.abs(goal.r - off.r) + Math.abs(off.vx) + Math.abs(off.vy) + Math.abs(off.vr) > 0.02
    }

    return busy
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
    const s = look.s.toFixed(3)
    const seam = look.seam.toFixed(3)

    element.setAttribute("points", turned.map(([x, y]) => `${(x + nx).toFixed(2)},${(y + ny).toFixed(2)}`).join(" "))

    if (piece.drawn.s !== s) element.style.setProperty("--s", (piece.drawn.s = s))
    if (piece.drawn.seam !== seam) element.style.setProperty("--seam", (piece.drawn.seam = seam))

    piece.look = look
  }

  function draw(now: number): void {
    frame = 0
    const dt = Math.min(0.032, last ? (now - last) / 1000 : 0.016)
    last = now
    let again = stepGlide(dt)
    aimHover()
    again = stepSprings(dt) || again
    let flying = false
    const T = trip ? clamp((now - trip.start) / trip.total, 0, 1) : 0

    pieces.forEach((piece, index) => {
      let points: Point[]
      let look: Look
      let ex = 0
      let ey = 0
      let er = 0

      if (mode === "closed" || mode === "open") {
        points = shape(index, mode === "closed" ? "button" : "window")
        look = mode === "closed" ? { s: 1, seam: 1 } : settled(index)
      } else {
        const opening = mode === "opening"
        const q = clamp((now - (trip?.start ?? now) - piece.trip.delay) / piece.trip.dur, 0, 1)
        flying ||= q < 1
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
        look = { s: 1 + (rest.s - 1) * k, seam: 1 + (rest.seam - 1) * k }
      }

      drawPiece(index, points, ex + piece.off.x, ey + piece.off.y, er + piece.off.r, look)
    })

    // The lines across the page belong to the closed page only.
    const lines = mode === "closed" ? 1 : mode === "opening" ? 1 - smooth(0, 0.22, T) : mode === "closing" ? smooth(0.8, 1, T) : 0
    parts.waves.forEach((path, index) => {
      path.style.opacity = String(lines)

      if (lines) {
        const { off } = pieces[WAVE_HOSTS[index]!]!
        const y = WAVES[index]!
        const points = ([[-165, y], [-110, y - 38], [-55, y - 38], [0, y], [55, y + 38], [110, y + 38], [165, y]] as Point[])
          .map(onto(buttonBox()))
          .map(([x, py]) => `${(x + off.x).toFixed(2)} ${(py + off.y).toFixed(2)}`)
        path.setAttribute("d", `M${points[0]} C${points[1]} ${points[2]} ${points[3]} C${points[4]} ${points[5]} ${points[6]}`)
      }
    })

    if (mode !== "closed") {
      const shown = mode === "opening" ? smooth(0.5, 0.92, T) : mode === "closing" ? 1 - smooth(0, 150, now - (trip?.clicked ?? now)) : 1
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

    // The button's lift, and the window's once the pieces are the window.
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

    if (trip && !flying) {
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

  const onPointer = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") {
      pointer = { x: event.clientX, y: event.clientY }

      if (mode === "closed") kick()
    }
  }
  const onLeave = (): void => {
    pointer = null
    kick()
  }
  const onHitDown = (event: PointerEvent): void => {
    swallowClick = false

    if (mode !== "closed" || event.button !== 0) return

    parts.hit.setPointerCapture?.(event.pointerId)
    drag = { from: { ...button }, id: event.pointerId, moved: false, start: { x: event.clientX, y: event.clientY } }
    glide = null

    if (event.pointerType === "touch") {
      pointer = { x: event.clientX, y: event.clientY }
      kick()
    }
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

    if (event.pointerType === "touch") pointer = null

    kick()
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
    [window, "pointermove", onPointer as EventListener],
    [document.documentElement, "pointerleave", onLeave],
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

// Whatever scrolls inside does it without showing a bar.
const QUIET_SCROLL = "[&_*]:[scrollbar-width:none] [&_*::-webkit-scrollbar]:hidden"

/**
 * Flow's button and window. The button is BizFlow's folded page: it parts a
 * little under the pointer, drags anywhere and settles on the nearest side,
 * and stays where it was left. Pressed, its pieces unfold into a window shaped
 * like the page, which moves by its top bar, resizes from any edge, and folds
 * back into the button from its folded corner or with Escape. On a phone the
 * window is a sheet with a grab bar that sets its height. What Flow says lives
 * inside, and stays mounted while the window is shut.
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
  const phone = useSyncExternalStore(subscribeToPhone, () => matchMedia(PHONE).matches, () => false)
  const titleId = useId()
  const windowId = useId()
  const shadowId = useId()
  const pieces = useRef<SVGPolygonElement[]>([])
  const waves = useRef<SVGPathElement[]>([])
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
    if (!mounted || !grab.current || !head.current || !hit.current || !outline.current || !shadow.current || !win.current) {
      return undefined
    }

    const running = animate({
      grab: grab.current,
      head: head.current,
      hit: hit.current,
      outline: outline.current,
      phoneBottom: () => latest.current.phoneBottom,
      pieces: pieces.current,
      setMode,
      shadow: shadow.current,
      toggle: (next) => latest.current.onOpenChange(next),
      waves: waves.current,
      win: win.current,
    })
    engine.current = running

    return () => {
      engine.current = null
      running.stop()
    }
  }, [mounted])

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
              style={PIECE_STYLE(piece.tone, piece.strength)}
            />
          ))}
        </g>
        {WAVES.map((y, index) => (
          <path
            fill="none"
            key={y}
            ref={(element) => {
              if (element) waves.current[index] = element
            }}
            strokeLinecap="round"
            strokeWidth={1.5}
            style={{ stroke: "color-mix(in oklch, var(--primary) 72%, var(--popover))" }}
          />
        ))}
        <path fill="none" opacity={0} ref={outline} strokeLinejoin="round" style={{ stroke: "var(--border)" }} />
      </svg>
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
        className="fixed top-0 left-0 z-40 cursor-pointer touch-none rounded-[12px] outline-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-ring/40"
        data-slot="flow-launcher"
        hidden={mode !== "closed"}
        ref={hit}
        style={{ height: PAGE.h + REACH.y * 2, width: PAGE.w + REACH.x * 2 }}
        title={title}
        type="button"
      />
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
