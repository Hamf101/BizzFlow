"use client"

import { type ReactElement, useEffect, useRef, useSyncExternalStore } from "react"

import { CORNERS, FACETS, FLAP, type Point, WAVES } from "@/components/brand/folded-page"
import { cn } from "@/lib/utils"

// The same facets become a wide folder with a raised tab at its top left.
const FOLDER: Record<keyof typeof CORNERS, Point> = {
  tl: [-225, -185], m4: [-70, -185], p1: [-25, -115], p2: [225, -115],
  m1: [-225, 0], m2: [0, 205], m3: [225, 70], p3: [225, 205], p4: [-225, 205],
  c1: [-90, -45], c2: [65, 55], c3: [-110, 100], c4: [80, -45],
}
const PIECES = [
  ...FACETS.map((facet) => ({
    page: facet.corners.map((corner) => CORNERS[corner]),
    folder: facet.corners.map((corner) => FOLDER[corner]),
    strength: facet.strength,
    tone: facet.tones[0],
  })),
  { page: FLAP, folder: [FOLDER.p1, FOLDER.p1, FOLDER.p2], strength: 1, tone: "wisteria" },
]
const points = (vertices: readonly Point[]): string => vertices.map((point) => point.join(",")).join(" ")
const MOTION_QUERY = "(prefers-reduced-motion: reduce)"
const CYCLE = "20s"

function subscribeMotion(onChange: () => void): () => void {
  const query = matchMedia(MOTION_QUERY)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

/** Holds each silhouette before smoothly morphing its matching vertices or lines. */
function Morph({ attribute, page, folder }: { attribute: string; page: string; folder: string }): ReactElement {
  return <animate attributeName={attribute} calcMode="spline" dur={CYCLE} keySplines="0 0 1 1; 0.4 0 0.2 1; 0 0 1 1; 0.4 0 0.2 1" keyTimes="0;0.4;0.5;0.9;1" repeatCount="indefinite" values={`${page};${page};${folder};${folder};${page}`} />
}

/** Pieces peel outward, turn independently, then gather into the next silhouette. */
function Reassemble({ index, vertices }: { index: number; vertices: readonly Point[] }): ReactElement {
  const x = vertices.reduce((sum, point) => sum + point[0], 0) / vertices.length
  const y = vertices.reduce((sum, point) => sum + point[1], 0) / vertices.length
  const length = Math.hypot(x, y) || 1
  const reach = 65 + (index % 3) * 18
  const dx = (x / length) * reach
  const dy = (y / length) * reach
  const turn = (index % 2 ? 1 : -1) * (14 + (index % 3) * 6)
  const lag = (index % 4) * 0.004
  const timing = {
    calcMode: "spline" as const,
    dur: CYCLE,
    keySplines: "0 0 1 1; 0.2 0 0.2 1; 0.2 0.8 0.2 1; 0 0 1 1; 0.2 0 0.2 1; 0.2 0.8 0.2 1",
    keyTimes: `0;${0.4 + lag};${0.445 + lag};0.5;${0.9 + lag};${0.945 + lag};1`,
    repeatCount: "indefinite",
  }
  return (
    <>
      <animateTransform {...timing} attributeName="transform" type="translate" values={`0 0;0 0;${dx} ${dy};0 0;0 0;${dx * 0.85} ${dy * 0.85};0 0`} />
      <animateTransform {...timing} additive="sum" attributeName="transform" type="rotate" values={`0 ${x} ${y};0 ${x} ${y};${turn} ${x} ${y};0 ${x} ${y};0 ${x} ${y};${-turn} ${x} ${y};0 ${x} ${y}`} />
    </>
  )
}

/**
 * Renders Flow's faceted page alternating with a folder, with pieces that part under the pointer.
 * @param props - Optional sizing classes.
 * @returns A decorative mark; its surrounding link or wordmark supplies the accessible name.
 */
export function BizFlowMark({ className }: { className?: string }): ReactElement {
  const ref = useRef<SVGSVGElement>(null)
  const reduced = useSyncExternalStore(subscribeMotion, () => matchMedia(MOTION_QUERY).matches, () => true)

  useEffect(() => {
    const svg = ref.current
    if (!svg || reduced) return
    const target = svg.closest("a") ?? svg
    const pieces = [...svg.querySelectorAll<SVGGElement>("[data-piece]")]
    const reset = (): void => pieces.forEach((piece) => piece.removeAttribute("transform"))
    const move = (event: Event): void => {
      const pointer = event as PointerEvent
      const box = svg.getBoundingClientRect()
      if (!box.width || !box.height) return
      const x = ((pointer.clientX - box.left) / box.width - 0.5) * 600
      const y = ((pointer.clientY - box.top) / box.height - 0.5) * 600
      pieces.forEach((piece, index) => {
        // Measure the current silhouette, so the folder reacts where its pieces actually are.
        const bounds = piece.getBBox()
        const cx = bounds.x + bounds.width / 2
        const cy = bounds.y + bounds.height / 2
        const dx = cx - x
        const dy = cy - y
        const distance = Math.hypot(dx, dy)
        const push = 32 * Math.exp(-(distance * distance) / 28000)
        const scale = push / (distance || 1)
        piece.setAttribute("transform", `translate(${dx * scale} ${dy * scale}) rotate(${(index % 2 ? 1 : -1) * push / 7} ${cx} ${cy})`)
      })
    }
    target.addEventListener("pointermove", move)
    target.addEventListener("pointerleave", reset)
    return () => {
      target.removeEventListener("pointermove", move)
      target.removeEventListener("pointerleave", reset)
      reset()
    }
  }, [reduced])

  return (
    <svg aria-hidden="true" className={cn("size-11 overflow-visible", className)} data-slot="bizflow-mark" ref={ref} viewBox="-300 -300 600 600">
      {PIECES.map((piece, index) => (
        <g className="motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out" data-piece="" key={index}>
          <polygon
            points={points(piece.page)}
            strokeLinejoin="round"
            strokeWidth="5"
            style={{ fill: `color-mix(in oklch, var(--fold-${piece.tone}) calc(${piece.strength} * var(--fold-strength) * 100%), var(--popover))`, stroke: "var(--fold-seam)" }}
          >
            {!reduced && <Morph attribute="points" folder={points(piece.folder)} page={points(piece.page)} />}
            {!reduced && <Reassemble index={index} vertices={piece.page} />}
          </polygon>
        </g>
      ))}
      {WAVES.map((y, index) => {
        const page = `M -165 ${y} C -110 ${y - 38} -55 ${y - 38} 0 ${y} C 55 ${y + 38} 110 ${y + 38} 165 ${y}`
        const folder = "M -205 -45 C -140 -45 -70 -45 0 -45 C 70 -45 140 -45 205 -45"
        return (
          <g className="motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out" data-piece="" key={y}>
            <path d={page} fill="none" strokeLinecap="round" strokeWidth="13" style={{ stroke: "var(--primary)" }}>
              {!reduced && <Morph attribute="d" folder={folder} page={page} />}
              {!reduced && index === 1 && <Morph attribute="opacity" folder="0" page="1" />}
              {!reduced && <Reassemble index={index} vertices={[[0, y]]} />}
            </path>
          </g>
        )
      })}
    </svg>
  )
}

/**
 * Renders the shared product wordmark with the animated BizFlow mark.
 * @param props - Whether to hide the supporting product descriptor.
 * @returns A compact mark and wordmark lockup.
 */
export function BizFlowWordmark({ compact = false }: { compact?: boolean }): ReactElement {
  return (
    <div className="flex items-center gap-2.5">
      <BizFlowMark className="size-9 shrink-0" />
      <span className="flex flex-col">
        <span className="font-editorial text-xl font-semibold leading-none tracking-[-0.02em]">BizFlow</span>
        {!compact && (
          <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Document studio</span>
        )}
      </span>
    </div>
  )
}
