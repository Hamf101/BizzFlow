"use client"

import { type ReactElement, useEffect, useRef } from "react"

import { BizFlowMark } from "./bizflow-mark"

// Moments in the logo's 20-second cycle: the page at rest, its turn into the folder (8–10s),
// the folder at rest, and the turn back (18–20s). Drawn once per theme, then played like a GIF.
const STEPS = 6
const turn = (from: number): number[] => Array.from({ length: STEPS - 1 }, (_, step) => from + (2 * (step + 1)) / STEPS)
const MOMENTS = [4, ...turn(8), 14, ...turn(18)]
const HOLD_MS = 8000
const FRAME_MS = 110

/**
 * Plays the logo's page-to-folder turn in the browser tab, in the page's current theme.
 * Browsers keep whatever the tab shows for bookmarks and shortcuts, so a turn in progress
 * finishes at once when the tab is hidden or the person clicks or types.
 * @returns An offscreen copy of the shared logo, paused and used only for drawing.
 */
export default function ThemedFavicon(): ReactElement {
  const host = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const svg = host.current?.querySelector("svg")
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = 32
    const context = canvas.getContext("2d")
    if (!svg || !context) return
    const icon = document.createElement("link")
    icon.rel = "icon"
    icon.type = "image/png"
    icon.setAttribute("sizes", "32x32")

    const paint = (seconds: number): string => {
      svg.setCurrentTime(seconds)
      context.resetTransform()
      context.clearRect(0, 0, 32, 32)
      // Fill the tab's fixed icon slot; ease back only when the flying pieces need room.
      const bounds = svg.getBBox()
      const extent = Math.max(250, -bounds.x + 10, bounds.x + bounds.width + 10, -bounds.y + 10, bounds.y + bounds.height + 10)
      const zoom = 300 / extent
      for (const shape of svg.querySelectorAll<SVGPolygonElement | SVGPathElement>("polygon, path")) {
        const matrix = shape.getCTM()
        if (!matrix) continue
        context.setTransform(
          matrix.a * zoom, matrix.b * zoom, matrix.c * zoom, matrix.d * zoom,
          matrix.e * zoom + 16 * (1 - zoom), matrix.f * zoom + 16 * (1 - zoom),
        )
        const style = getComputedStyle(shape)
        context.globalAlpha = Number(style.opacity)
        context.beginPath()
        if (shape instanceof SVGPolygonElement) {
          for (const point of shape.animatedPoints) context.lineTo(point.x, point.y)
          context.closePath()
          context.fillStyle = style.fill
          context.fill()
        } else {
          // Sampling the two tiny curves also captures their native SVG morph.
          const length = shape.getTotalLength()
          for (let step = 0; step <= 24; step += 1) {
            const point = shape.getPointAtLength((length * step) / 24)
            context.lineTo(point.x, point.y)
          }
        }
        context.strokeStyle = style.stroke
        context.lineWidth = Number.parseFloat(style.strokeWidth)
        context.lineJoin = "round"
        context.lineCap = "round"
        context.stroke()
      }
      return canvas.toDataURL("image/png")
    }

    let frames: string[] = []
    let index = 0
    let timer = 0
    const show = (): void => {
      if (icon.getAttribute("href") !== frames[index]) icon.href = frames[index]
      // The only icon link on the page, so the browser never picks between two pictures.
      if (!icon.isConnected) document.head.append(icon)
    }
    const draw = (): void => {
      frames = MOMENTS.map(paint)
      show()
    }
    const play = (): void => {
      window.clearTimeout(timer)
      if (document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches) return
      timer = window.setTimeout(() => {
        index = (index + 1) % MOMENTS.length
        show()
        play()
      }, index % STEPS === 0 ? HOLD_MS : FRAME_MS)
    }
    // Finish a turn in progress, so a hidden tab or a click never leaves it mid-way.
    const settle = (): void => {
      if (index % STEPS === 0) return
      index = (Math.ceil(index / STEPS) * STEPS) % MOMENTS.length
      show()
      play()
    }
    const onVisibility = (): void => {
      if (document.hidden) settle()
      play()
    }
    const start = (): void => {
      // The logo never plays here; each frame seeks to its moment. Its clock runs once the page has loaded.
      svg.pauseAnimations()
      draw()
      play()
    }
    let starting = 0
    const whenLoaded = (): void => { starting = window.setTimeout(start) }
    if (document.readyState === "complete") whenLoaded()
    else window.addEventListener("load", whenLoaded, { once: true })
    // Themes switch with a class on <html>; redraw the frames in the new colours.
    const theme = new MutationObserver(() => {
      if (frames.length) draw()
    })
    theme.observe(document.documentElement, { attributeFilter: ["class"] })
    document.addEventListener("visibilitychange", onVisibility)
    document.addEventListener("pointerdown", settle, true)
    document.addEventListener("keydown", settle, true)
    return () => {
      window.clearTimeout(starting)
      window.clearTimeout(timer)
      window.removeEventListener("load", whenLoaded)
      theme.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
      document.removeEventListener("pointerdown", settle, true)
      document.removeEventListener("keydown", settle, true)
      icon.remove()
    }
  }, [])

  return <span aria-hidden="true" className="pointer-events-none fixed -left-[9999px] top-0" ref={host}><BizFlowMark className="size-8" /></span>
}
