"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { type CSSProperties, type ReactElement, useEffect, useRef, useState } from "react"

import { type FoldLoops, playFoldLoops } from "@/components/auth/fold-loops"
import { CORNERS, FACETS, FLAP, type Point, type Tone, WAVES } from "@/components/brand/folded-page"

// How often the facets' tones move on.
const DRIFT_STEP_MS = 250
// How far the grid and the page move at full lean: the page further, so it reads as nearer.
const LEANS = [
  [".auth-grid", -8],
  [".auth-fold", -22],
] as const
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
 * The sign-in pages' shared backdrop: a dot grid and a folding page that gains
 * facets at every step. It stays in the layout, so moving between steps adds to
 * it instead of starting again, and it leans a little toward the cursor.
 */
export function AuthBackdrop(): ReactElement {
  const target = stepFor(usePathname(), useSearchParams().has("sent"))
  // Arrives bare and builds to this step, so a fresh visit grows in too.
  const [step, setStep] = useState(0)
  const ground = useRef<HTMLDivElement>(null)
  const figure = useRef<SVGGElement>(null)
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

  useEffect(() => lean(ground.current), [])

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
      drawn,
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
    <div aria-hidden="true" className="auth-backdrop pointer-events-none absolute inset-0" ref={ground}>
      <div className="auth-grid absolute -inset-10" />
      <svg
        // Centred behind the card: as tall as a wide screen allows, and on a
        // phone or tablet held upright, about two thirds of the height. It
        // draws past its own box, out to the screen's edge, so leaning never
        // shows where the box ends.
        className="auth-fold absolute top-0 left-1/2 h-full w-[max(100vw,110svh)] -translate-x-1/2 overflow-visible"
        data-whole={step === 4 || undefined}
        preserveAspectRatio="xMidYMid meet"
        viewBox="-500 -350 1000 700"
      >
        <g className="auth-fold-float">
          <g ref={figure} transform="scale(1.38)">
            {FACETS.map((facet, index) => (
              <g className="auth-fold-piece" key={facet.corners.join()}>
                <polygon
                  className="auth-fold-facet"
                  data-on={facet.at <= step}
                  points={facet.corners.map((corner) => CORNERS[corner].join(",")).join(" ")}
                  style={{ "--i": index, "--strength": facet.strength, ...tones(facet.tones) } as CSSProperties}
                />
              </g>
            ))}
            <g className="auth-fold-piece">
              <polygon
                className="auth-fold-facet"
                data-on={step >= 1}
                points={FLAP.map((point) => point.join(",")).join(" ")}
                style={{ "--i": 0, "--strength": 1, ...tones(["wisteria", "lilac", "orchid"]) } as CSSProperties}
              />
            </g>
            {WAVES.map((y, index) => (
              <g className="auth-fold-piece" key={y}>
                <path
                  className="auth-fold-wave"
                  d={`M -165 ${y} c 55 -38 110 -38 165 0 s 110 38 165 0`}
                  data-on={step >= 4}
                  pathLength={1}
                  style={{ transitionDelay: `${0.2 + index * 0.35}s` }}
                />
              </g>
            ))}
          </g>
        </g>
      </svg>
    </div>
  )
}

/**
 * Leans the backdrop toward the cursor, or the way a phone or tablet is
 * tilted. Until either arrives it drifts on its own, which is all an iPhone
 * gets, since reading its tilt needs a permission prompt. Every move is an
 * animation of the grid and the page themselves, so the browser moves them
 * without redrawing, even while its time goes to another window.
 *
 * @param ground - The backdrop, holding the grid and the page.
 * @returns A cleanup that stops listening.
 */
function lean(ground: HTMLElement | null): (() => void) | undefined {
  if (!ground || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return undefined
  }

  const movers = LEANS.map(([selector, reach]) => ({ element: ground.querySelector(selector)!, reach }))
  const at = (reach: number, x: number, y: number): string =>
    `translate3d(${(x * reach).toFixed(2)}px, ${(y * reach).toFixed(2)}px, 0)`
  let moving = movers.map(({ element, reach }) =>
    element.animate(
      DRIFT.map(([x, y, offset]) => ({ easing: "ease-in-out", offset, transform: at(reach, x, y) })),
      { direction: "alternate", duration: 24_000, iterations: Infinity }
    )
  )
  let frame = 0
  const toward = (x: number, y: number): void => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      // From wherever it has got to, its own drift included.
      const from = movers.map(({ element }) => getComputedStyle(element).transform)
      moving.forEach((animation) => animation.cancel())
      moving = movers.map(({ element, reach }, index) =>
        element.animate([{ transform: from[index] }, { transform: at(reach, clamp(x), clamp(y)) }], {
          duration: 900,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          fill: "forwards",
        })
      )
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
    moving.forEach((animation) => animation.cancel())
    removeEventListener("pointermove", onPointer)
    removeEventListener("deviceorientation", onTilt)
  }
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value))
}
