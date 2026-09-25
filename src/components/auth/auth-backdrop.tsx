"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { type CSSProperties, type ReactElement, useEffect, useRef, useState } from "react"

import { playFoldLoops } from "@/components/auth/fold-loops"

type Corner = keyof typeof CORNERS
type Tone = "lavender" | "lilac" | "wisteria" | "orchid" | "periwinkle" | "rose" | "sage"

// A page with its corner folded, as in the BizFlow mark, cut into facets.
const CORNERS = {
  c1: [-40, -60],
  c2: [60, 40],
  c3: [-90, 120],
  c4: [100, -60],
  m1: [-180, 0],
  m2: [0, 230],
  m3: [180, 60],
  m4: [-40, -230],
  p1: [90, -230],
  p2: [180, -140],
  p3: [180, 230],
  p4: [-180, 230],
  tl: [-180, -230],
} as const

// Each facet arrives at a step and, once the page is whole, drifts through its
// three tones. Mostly purples, with a little rose and sage.
const FACETS: ReadonlyArray<{ at: number; corners: [Corner, Corner, Corner]; strength: number; tones: [Tone, Tone, Tone] }> = [
  { at: 1, corners: ["p1", "p2", "c4"], strength: 0.9, tones: ["lilac", "orchid", "lavender"] },
  { at: 2, corners: ["m4", "p1", "c1"], strength: 0.7, tones: ["lavender", "periwinkle", "lilac"] },
  { at: 2, corners: ["p1", "c4", "c1"], strength: 0.85, tones: ["wisteria", "lilac", "orchid"] },
  { at: 2, corners: ["tl", "m4", "c1"], strength: 0.6, tones: ["orchid", "rose", "lavender"] },
  { at: 2, corners: ["p2", "m3", "c4"], strength: 0.75, tones: ["periwinkle", "lavender", "wisteria"] },
  { at: 3, corners: ["c4", "m3", "c2"], strength: 0.65, tones: ["lilac", "wisteria", "periwinkle"] },
  { at: 3, corners: ["c1", "c4", "c2"], strength: 0.5, tones: ["rose", "orchid", "lavender"] },
  { at: 3, corners: ["tl", "c1", "m1"], strength: 0.8, tones: ["lavender", "lilac", "orchid"] },
  { at: 3, corners: ["m1", "c1", "c3"], strength: 0.6, tones: ["wisteria", "periwinkle", "lilac"] },
  { at: 3, corners: ["c1", "c2", "c3"], strength: 0.85, tones: ["orchid", "lavender", "rose"] },
  { at: 3, corners: ["m1", "c3", "p4"], strength: 0.55, tones: ["lilac", "wisteria", "lavender"] },
  { at: 3, corners: ["c3", "m2", "p4"], strength: 0.7, tones: ["rose", "orchid", "lilac"] },
  { at: 3, corners: ["c3", "c2", "m2"], strength: 0.9, tones: ["lavender", "lilac", "sage"] },
  { at: 3, corners: ["c2", "m3", "p3"], strength: 0.6, tones: ["periwinkle", "wisteria", "lilac"] },
  { at: 3, corners: ["c2", "p3", "m2"], strength: 0.75, tones: ["sage", "lavender", "periwinkle"] },
]

const FLAP: [Point, Point, Point] = [[90, -230], [90, -140], [180, -140]]
const WAVES = [-20, 70]

type Point = readonly [number, number]

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

  useEffect(() => {
    const frame = requestAnimationFrame(() => setStep(target))
    return () => cancelAnimationFrame(frame)
  }, [target])

  useEffect(() => lean(ground.current), [])

  // Once whole, the page now and then comes apart and folds back together.
  useEffect(() => {
    if (step !== 4 || !figure.current || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined
    }

    // The pieces are drawn in the same order as CENTERS; the waves, last, are
    // lines across the page rather than pieces of it.
    const pieces = [...figure.current.querySelectorAll(".auth-fold-piece")]
    return playFoldLoops(
      figure.current,
      pieces.map((element, index) => ({ center: CENTERS[index]!, element, line: index > FACETS.length }))
    )
  }, [step])

  return (
    <div aria-hidden="true" className="auth-backdrop pointer-events-none absolute inset-0" data-idle="" ref={ground}>
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
 * tilted. Until either arrives it drifts on its own (`auth-lean`), which is all
 * an iPhone gets, since reading its tilt needs a permission prompt.
 *
 * @param ground - The backdrop, which carries the lean as CSS variables.
 * @returns A cleanup that stops listening.
 */
function lean(ground: HTMLElement | null): (() => void) | undefined {
  if (!ground || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return undefined
  }

  let frame = 0
  const toward = (x: number, y: number): void => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      delete ground.dataset.idle
      ground.style.setProperty("--lean-x", clamp(x).toFixed(3))
      ground.style.setProperty("--lean-y", clamp(y).toFixed(3))
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
    removeEventListener("pointermove", onPointer)
    removeEventListener("deviceorientation", onTilt)
  }
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value))
}
