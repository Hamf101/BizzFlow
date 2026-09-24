"use client"

import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactElement, useState } from "react"

/** Hue in degrees, saturation and brightness from 0 to 1. */
type Hsv = Readonly<{ h: number; s: number; v: number }>

// Each hue sits at its angle, clockwise from the top; white fills the centre.
const WHEEL_BACKGROUND =
  "radial-gradient(closest-side, #fff, transparent), conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"

/**
 * Picks any colour by eye: a wheel for hue and saturation, and a slider for
 * brightness. Left and right turn the wheel, up and down move toward its rim,
 * and Shift takes larger steps.
 *
 * @param props - What the colour is for, the colour as a hex code, and what to do with a new one.
 * @returns The wheel and its brightness slider.
 */
export function ColorWheel({
  label,
  onChange,
  value,
}: {
  label: string
  onChange: (hex: string) => void
  value: string
}): ReactElement {
  const hex = value.toLowerCase()
  const [hsv, setHsv] = useState<Hsv>(() => toHsv(hex))
  const [seen, setSeen] = useState(hex)

  // A code from elsewhere moves the wheel. The wheel's own colour keeps its hue
  // even at black or white, which have none, so brightening it again returns.
  if (hex !== seen) {
    setSeen(hex)

    if (toHex(hsv) !== hex) {
      setHsv(toHsv(hex))
    }
  }

  function pick(next: Hsv): void {
    setHsv(next)

    if (toHex(next) !== hex) {
      onChange(toHex(next))
    }
  }

  function pointAt(event: PointerEvent<HTMLDivElement>): void {
    const box = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - box.left - box.width / 2
    const y = event.clientY - box.top - box.height / 2

    pick({
      ...hsv,
      h: ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360,
      s: Math.min(1, Math.hypot(x, y) / (box.width / 2)),
    })
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 15 : 5
    const moves: Record<string, Partial<Hsv>> = {
      ArrowDown: { s: Math.max(0, hsv.s - step / 100) },
      ArrowLeft: { h: (hsv.h - step + 360) % 360 },
      ArrowRight: { h: (hsv.h + step) % 360 },
      ArrowUp: { s: Math.min(1, hsv.s + step / 100) },
    }
    const move = moves[event.key]

    if (move) {
      event.preventDefault()
      pick({ ...hsv, ...move })
    }
  }

  const angle = (hsv.h * Math.PI) / 180

  return (
    <div className="grid gap-3">
      <div
        aria-label={`${label} hue and saturation`}
        aria-valuemax={360}
        aria-valuemin={0}
        aria-valuenow={Math.round(hsv.h)}
        aria-valuetext={`Hue ${Math.round(hsv.h)} degrees, saturation ${Math.round(hsv.s * 100)}%`}
        className="relative mx-auto size-44 cursor-crosshair touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
        onKeyDown={handleKey}
        onPointerDown={(event: PointerEvent<HTMLDivElement>): void => {
          event.currentTarget.setPointerCapture(event.pointerId)
          pointAt(event)
        }}
        onPointerMove={(event: PointerEvent<HTMLDivElement>): void => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            pointAt(event)
          }
        }}
        role="slider"
        style={{ background: WHEEL_BACKGROUND }}
        tabIndex={0}
      >
        {/* The wheel stays bright so hues read clearly; the handle shows the real colour. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-4 -translate-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
          style={{
            backgroundColor: toHex(hsv),
            left: `${50 + 50 * hsv.s * Math.sin(angle)}%`,
            top: `${50 - 50 * hsv.s * Math.cos(angle)}%`,
          }}
        />
      </div>
      <input
        aria-label={`${label} brightness`}
        className="h-3 w-full cursor-pointer appearance-none rounded-full border outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-(--thumb) [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-(--thumb) [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
        max={100}
        min={0}
        onChange={(event): void => pick({ ...hsv, v: Number(event.target.value) / 100 })}
        style={{
          "--thumb": toHex(hsv),
          background: `linear-gradient(to right, #000, ${toHex({ ...hsv, v: 1 })})`,
        } as CSSProperties}
        type="range"
        value={Math.round(hsv.v * 100)}
      />
    </div>
  )
}

function toHsv(hex: string): Hsv {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at: number): number => Number.parseInt(hex.slice(at, at + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const range = max - Math.min(r, g, b)
  const sector =
    range === 0 ? 0 : max === r ? ((g - b) / range + 6) % 6 : max === g ? (b - r) / range + 2 : (r - g) / range + 4

  return { h: sector * 60, s: max === 0 ? 0 : range / max, v: max }
}

function toHex({ h, s, v }: Hsv): string {
  const channel = (offset: number): string => {
    const k = (offset + h / 60) % 6
    const level = v - v * s * Math.max(0, Math.min(k, 4 - k, 1))

    return Math.round(level * 255).toString(16).padStart(2, "0")
  }

  return `#${channel(5)}${channel(3)}${channel(1)}`
}
