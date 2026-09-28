"use client"

import { type ReactElement, useEffect, useRef } from "react"

import { BizFlowMark } from "./bizflow-mark"

/**
 * Mirrors the logo's actual animated geometry into a PNG browser-tab icon.
 * @returns An offscreen copy of the shared logo, including its reduced-motion behavior.
 */
export default function AnimatedFavicon(): ReactElement {
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
    let previous = ""
    let frameRequest = 0

    const paint = (): void => {
      // Shorten only the tab's two-second morphs to 650ms, keeping eight-second holds.
      // Check on paint because reduced-motion hydration can add the animations after mount.
      for (const animation of svg.querySelectorAll('[dur="20s"][keyTimes]')) {
        const times = animation.getAttribute("keyTimes")!.split(";").map((value) => {
          const seconds = Number(value) * 20
          const half = Math.floor(seconds / 10)
          const local = seconds % 10
          return (half * 8.65 + Math.min(local, 8) + Math.max(0, local - 8) * 0.325) / 17.3
        })
        animation.setAttribute("keyTimes", times.join(";"))
        animation.setAttribute("dur", "17.3s")
      }
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
      const frame = canvas.toDataURL("image/png")
      if (frame !== previous) {
        icon.href = previous = frame
        // Keep the same link in place so each frame only changes its pixels.
        if (!icon.isConnected) document.head.append(icon)
      }
    }
    const tick = (): void => {
      paint()
      frameRequest = requestAnimationFrame(tick)
    }
    const schedule = (): void => {
      cancelAnimationFrame(frameRequest)
      if (document.hidden) return
      tick()
    }
    schedule()
    document.addEventListener("visibilitychange", schedule)
    return () => {
      cancelAnimationFrame(frameRequest)
      document.removeEventListener("visibilitychange", schedule)
      icon.remove()
    }
  }, [])

  return <span aria-hidden="true" className="pointer-events-none fixed -left-[9999px] top-0" ref={host}><BizFlowMark className="size-8" /></span>
}
