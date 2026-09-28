"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { type CSSProperties, type ReactElement, type ReactNode, useEffect, useRef, useState } from "react"

import { type FoldLoops, playFoldLoops } from "@/components/auth/fold-loops"
import { CORNERS, FACETS, FLAP, type Point, type Tone, WAVES } from "@/components/brand/folded-page"

// How often the facets' tones move on.
const DRIFT_STEP_MS = 250
// How far the page moves at full lean.
const LEAN_REACH = -22
// The ground's diamonds, point to point, and how far the shade around the
// pointer reaches before the ground is plain again.
const DIAMOND = 104
const SHADE_REACH = 520
// How dark the diamond under the pointer is; at night it lightens instead (globals.css).
const SHADE_DEPTH = 0.1
// How much of the way to the pointer the shade closes each frame.
const SHADE_EASE = 0.12
// Where the backdrop leans on its own until a cursor or tilt arrives, and how far through it gets there.
const DRIFT = [
  [-0.6, -0.3, 0],
  [0.4, 0.5, 0.35],
  [0.7, -0.4, 0.7],
  [-0.3, 0.6, 1],
] as const

function middle(points: readonly Point[]): { x: number; y: number } {
  return {
    x: points.reduce((sum, [x]) => sum + x, 0) / points.length,
    y: points.reduce((sum, [, y]) => sum + y, 0) / points.length,
  }
}

// Every piece that comes apart, in the order it's drawn: facets, the fold, the waves.
const CENTERS = [
  ...FACETS.map((facet) => middle(facet.corners.map((corner) => CORNERS[corner]))),
  middle(FLAP),
  ...WAVES.map((y) => ({ x: 0, y })),
]

/**
 * How much of the page each step has built: someone new builds it as they
 * sign up and name their workspace; someone returning sees it whole.
 */
function stepFor(pathname: string, sent: boolean): number {
  if (pathname === "/signup") {
    return sent ? 2 : 1
  }

  if (pathname === "/confirm-email") {
    return 2
  }

  return pathname === "/welcome" || pathname.startsWith("/accept-invite/") ? 3 : 4
}

function tones([first, second, third]: [Tone, Tone, Tone]): Record<string, string> {
  return { "--fold-from": `var(--fold-${first})`, "--fold-via": `var(--fold-${second})`, "--fold-to": `var(--fold-${third})` }
}

/**
 * The sign-in pages' shared backdrop: a folding page that gains facets at
 * every step, over a ground of diamonds that shade around the pointer. It
 * stays in the layout, so moving between steps adds to it instead of starting
 * again, and it leans a little toward the cursor.
 */
export function AuthBackdrop(): ReactElement {
  const target = stepFor(usePathname(), useSearchParams().has("sent"))
  // Arrives bare and builds to this step, so a fresh visit grows in too.
  const [step, setStep] = useState(0)
  const grid = useRef<HTMLCanvasElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const figure = useRef<HTMLDivElement>(null)
  const loops = useRef<FoldLoops | null>(null)

  useEffect(() => {
    let current = true
    let frame = 0

    // A page that has come apart folds back together before it loses facets.
    void Promise.resolve(target < 4 ? loops.current?.gather() : undefined).then(() => {
      if (current) {
        frame = requestAnimationFrame(() => setStep(target))
      }
    })

    return () => {
      current = false
      cancelAnimationFrame(frame)
    }
  }, [target])

  useEffect(() => lean(page.current), [])
  useEffect(() => shade(grid.current), [])

  // Once whole, the page now and then comes apart and folds back together.
  useEffect(() => {
    if (step !== 4 || !figure.current || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined
    }

    // The pieces are drawn in the same order as CENTERS; the waves, last, are
    // lines across the page rather than pieces of it.
    const drawn = figure.current
    const pieces = [...drawn.querySelectorAll(".auth-fold-piece")]
    const playing = playFoldLoops(
      // Every piece at rest is drawn in the same place, in the same units.
      drawn.querySelector("g")!,
      pieces.map((element, index) => ({ center: CENTERS[index]!, element, line: index > FACETS.length }))
    )
    loops.current = playing
    // Moves the held tones on, each nudge too small to see (globals.css).
    const started = performance.now()
    const drift = window.setInterval(() => {
      for (const animation of drawn.getAnimations({ subtree: true })) {
        if (animation instanceof CSSAnimation && animation.animationName === "auth-fold-drift") {
          animation.currentTime = performance.now() - started
        }
      }
    }, DRIFT_STEP_MS)

    return () => {
      loops.current = null
      playing.stop()
      clearInterval(drift)
    }
  }, [step])

  return (
    <div aria-hidden="true" className="auth-backdrop pointer-events-none absolute inset-0">
      <canvas className="auth-grid absolute inset-0 size-full" ref={grid} />
      <div
        // Centred behind the card: as tall as a wide screen allows, and on a
        // phone or tablet held upright, about two thirds of the height. It
        // draws past its own box, out to the screen's edge, so leaning never
        // shows where the box ends.
        className="auth-fold absolute top-0 left-1/2 h-full w-[max(100vw,110svh)] -translate-x-1/2"
        data-whole={step === 4 || undefined}
        ref={page}
      >
        <div className="auth-fold-float absolute inset-0" ref={figure}>
          {FACETS.map((facet, index) => (
            <Piece key={facet.corners.join()}>
              <polygon
                className="auth-fold-facet"
                data-on={facet.at <= step}
                points={facet.corners.map((corner) => CORNERS[corner].join(",")).join(" ")}
                style={{ "--i": index, "--strength": facet.strength, ...tones(facet.tones) } as CSSProperties}
              />
            </Piece>
          ))}
          <Piece>
            <polygon
              className="auth-fold-facet"
              data-on={step >= 1}
              points={FLAP.map((point) => point.join(",")).join(" ")}
              style={{ "--i": 0, "--strength": 1, ...tones(["wisteria", "lilac", "orchid"]) } as CSSProperties}
            />
          </Piece>
          {WAVES.map((y, index) => (
            <Piece key={y}>
              <path
                className="auth-fold-wave"
                d={`M -165 ${y} c 55 -38 110 -38 165 0 s 110 38 165 0`}
                data-on={step >= 4}
                pathLength={1}
                style={{ transitionDelay: `${0.2 + index * 0.35}s` }}
              />
            </Piece>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * One piece of the page, drawn in a box of its own, since every move is made
 * on a box: on a scaled screen, a Retina one included, Chrome redraws a shape
 * moved inside an SVG every frame, and those redraws fall behind whenever
 * another window has the focus. A box it moves without redrawing.
 */
function Piece({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="auth-fold-piece absolute inset-0">
      <svg className="size-full overflow-visible" preserveAspectRatio="xMidYMid meet" viewBox="-500 -350 1000 700">
        <g transform="scale(1.38)">{children}</g>
      </svg>
    </div>
  )
}

/**
 * Leans the page toward the cursor, or the way a phone or tablet is tilted.
 * Until either arrives it drifts on its own, which is all an iPhone gets,
 * since reading its tilt needs a permission prompt. Every move is an
 * animation of the page itself, so the browser moves it without redrawing,
 * even while its time goes to another window.
 *
 * @param page - The folding page.
 * @returns A cleanup that stops listening.
 */
function lean(page: HTMLElement | null): (() => void) | undefined {
  if (!page || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return undefined
  }

  const at = (x: number, y: number): string =>
    `translate3d(${(x * LEAN_REACH).toFixed(2)}px, ${(y * LEAN_REACH).toFixed(2)}px, 0)`
  let moving = page.animate(
    DRIFT.map(([x, y, offset]) => ({ easing: "ease-in-out", offset, transform: at(x, y) })),
    { direction: "alternate", duration: 24_000, iterations: Infinity }
  )
  let frame = 0
  const toward = (x: number, y: number): void => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      // From wherever it has got to, its own drift included.
      const from = getComputedStyle(page).transform
      moving.cancel()
      moving = page.animate([{ transform: from }, { transform: at(clamp(x), clamp(y)) }], {
        duration: 900,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        fill: "forwards",
      })
    })
  }
  const onPointer = (event: PointerEvent): void => {
    if (event.pointerType === "mouse") {
      toward((event.clientX / innerWidth) * 2 - 1, (event.clientY / innerHeight) * 2 - 1)
    }
  }
  // Held to read, a phone sits about 45 degrees back; tilting it steers like a cursor.
  const onTilt = (event: DeviceOrientationEvent): void => {
    if (event.gamma !== null && event.beta !== null) {
      toward(event.gamma / 25, (event.beta - 45) / 25)
    }
  }

  addEventListener("pointermove", onPointer)
  addEventListener("deviceorientation", onTilt)

  return () => {
    cancelAnimationFrame(frame)
    moving.cancel()
    removeEventListener("pointermove", onPointer)
    removeEventListener("deviceorientation", onTilt)
  }
}

/**
 * Shades the ground's diamonds around the pointer, each diamond one flat tone,
 * so the shade steps out facet by facet. Until a pointer arrives it rests
 * toward the top right; then it eases after the pointer, or a tap on a phone.
 * With reduced motion it stays where it rests.
 *
 * @param canvas - The ground, drawn in black at the shade's strength.
 * @returns A cleanup that stops listening.
 */
function shade(canvas: HTMLCanvasElement | null): (() => void) | undefined {
  const context = canvas?.getContext("2d")

  if (!canvas || !context) {
    return undefined
  }

  const half = DIAMOND / 2
  let at = { x: 0, y: 0 }
  let to: typeof at | null = null
  let frame = 0
  const draw = (): void => {
    const { clientHeight: height, clientWidth: width } = canvas
    const rows = Math.ceil(height / DIAMOND) + 1
    const columns = Math.ceil(width / 2 / DIAMOND) + 1
    context.clearRect(0, 0, width, height)
    // Centred on the screen, so a diamond sits square behind the card.
    for (let row = -rows; row <= rows; row += 1) {
      const y = height / 2 + row * half
      for (let column = -columns; column <= columns; column += 1) {
        const x = width / 2 + column * DIAMOND + (row % 2 ? half : 0)
        const depth = SHADE_DEPTH * (1 - Math.hypot(x - at.x, y - at.y) / SHADE_REACH)
        if (depth > 0) {
          context.globalAlpha = depth
          context.beginPath()
          context.moveTo(x, y - half)
          context.lineTo(x + half, y)
          context.lineTo(x, y + half)
          context.lineTo(x - half, y)
          context.fill()
        }
      }
    }
  }
  const fit = (): void => {
    const ratio = devicePixelRatio
    canvas.width = Math.round(canvas.clientWidth * ratio)
    canvas.height = Math.round(canvas.clientHeight * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    at = to ?? { x: canvas.clientWidth * 0.75, y: canvas.clientHeight * 0.3 }
    draw()
  }
  const step = (): void => {
    const target = to ?? at
    at = { x: at.x + (target.x - at.x) * SHADE_EASE, y: at.y + (target.y - at.y) * SHADE_EASE }
    const settled = Math.hypot(target.x - at.x, target.y - at.y) < 0.5
    at = settled ? target : at
    draw()
    frame = settled ? 0 : requestAnimationFrame(step)
  }
  const onPointer = (event: PointerEvent): void => {
    const box = canvas.getBoundingClientRect()
    to = { x: event.clientX - box.left, y: event.clientY - box.top }
    frame ||= requestAnimationFrame(step)
  }
  const resized = new ResizeObserver(fit)

  resized.observe(canvas)
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    addEventListener("pointermove", onPointer)
    addEventListener("pointerdown", onPointer)
  }

  return () => {
    cancelAnimationFrame(frame)
    resized.disconnect()
    removeEventListener("pointermove", onPointer)
    removeEventListener("pointerdown", onPointer)
  }
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value))
}
