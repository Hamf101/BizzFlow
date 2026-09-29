"use client"

import {
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  useId,
  useRef,
  useState,
} from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"

type DrawnSignatureFieldProps = {
  /** Only the drawing area, filling the box it is put in, as a page shows it. */
  bare?: boolean
  description?: string
  label: string
  name: string
  required?: boolean
  /** A drawing already saved, shown in a bare area until one is drawn over it. */
  saved?: string
}

/**
 * Captures a basic pointer-drawn signature or initials as a PNG data URL.
 *
 * @param props - Form field name, label, helper text, and required state.
 * @returns Responsive canvas with a hidden form value and clear control.
 */
export function DrawnSignatureField({
  bare = false,
  description = "Draw with a mouse, finger, or stylus.",
  label,
  name,
  required = false,
  saved = "",
}: DrawnSignatureFieldProps): ReactElement {
  const fieldId = useId()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const isDrawingRef = useRef<boolean>(false)
  const strokeChangedRef = useRef<boolean>(false)
  const [dataUrl, setDataUrl] = useState<string>("")
  const [redrawing, setRedrawing] = useState<boolean>(false)

  function handlePointerDown(
    event: ReactPointerEvent<HTMLCanvasElement>
  ): void {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    const context = canvas.getContext("2d")

    if (!context) {
      return
    }

    // A bare area takes its box's size, so a stroke is not stretched.
    if (bare && !dataUrl) {
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(canvas.clientWidth * ratio)
      canvas.height = Math.round(canvas.clientHeight * ratio)
      setRedrawing(true)
    }

    const point = getCanvasPoint(canvas, event.clientX, event.clientY)
    event.currentTarget.setPointerCapture(event.pointerId)
    isDrawingRef.current = true
    strokeChangedRef.current = false
    context.beginPath()
    context.moveTo(point.x, point.y)
  }

  function handlePointerMove(
    event: ReactPointerEvent<HTMLCanvasElement>
  ): void {
    const canvas = canvasRef.current

    if (!canvas || !isDrawingRef.current) {
      return
    }

    const context = canvas.getContext("2d")

    if (!context) {
      return
    }

    const point = getCanvasPoint(canvas, event.clientX, event.clientY)
    context.lineCap = "round"
    context.lineJoin = "round"
    context.lineWidth = bare ? 2 * (window.devicePixelRatio || 1) : 3
    context.strokeStyle = "#252329"
    context.lineTo(point.x, point.y)
    context.stroke()
    strokeChangedRef.current = true
  }

  function handlePointerEnd(): void {
    const canvas = canvasRef.current

    if (!canvas || !isDrawingRef.current) {
      return
    }

    isDrawingRef.current = false

    // A tap without movement leaves the value empty; the server should never
    // accept a blank canvas as a required signature.
    if (strokeChangedRef.current) {
      setDataUrl(canvas.toDataURL("image/png"))
    }
  }

  function clearDrawing(): void {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    const context = canvas.getContext("2d")
    context?.clearRect(0, 0, canvas.width, canvas.height)
    isDrawingRef.current = false
    strokeChangedRef.current = false
    setDataUrl("")
    setRedrawing(false)
  }

  const handlers = {
    onPointerCancel: handlePointerEnd,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerEnd,
  }

  if (bare) {
    return (
      <>
        {saved && !redrawing ? (
          // eslint-disable-next-line @next/next/no-img-element -- a drawn data URL, already sized
          <img alt={`Saved ${label}`} className="doc-drawing max-h-[4.5em] max-w-[15em] object-contain object-left" src={saved} />
        ) : null}
        <canvas
          aria-label={`${label} drawing area`}
          className="doc-drawing absolute inset-0 size-full cursor-crosshair touch-none"
          {...handlers}
          ref={canvasRef}
          role="img"
        />
        <input name={name} type="hidden" value={dataUrl} />
        {dataUrl ? (
          <button
            className="absolute top-[0.3em] right-[0.5em] text-[0.8em] text-muted-foreground hover:text-foreground"
            onClick={clearDrawing}
            type="button"
          >
            Clear
          </button>
        ) : null}
      </>
    )
  }

  return (
    <Field>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel htmlFor={fieldId}>
          {label}
          {required ? " *" : ""}
        </FieldLabel>
        <Button
          // Overhangs its row, so the label sits where every field's label
          // sits and lines up with the fields beside it in a row.
          className="-my-2"
          disabled={!dataUrl}
          onClick={clearDrawing}
          size="sm"
          type="button"
          variant="ghost"
        >
          Clear
        </Button>
      </div>
      <canvas
        aria-label={`${label} drawing area`}
        className="h-36 w-full touch-none rounded-lg border bg-white"
        height={180}
        id={fieldId}
        {...handlers}
        ref={canvasRef}
        role="img"
        width={640}
      />
      <input name={name} type="hidden" value={dataUrl} />
      <FieldDescription>{description}</FieldDescription>
    </Field>
  )
}

function getCanvasPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const bounds = canvas.getBoundingClientRect()

  return {
    x: ((clientX - bounds.left) / bounds.width) * canvas.width,
    y: ((clientY - bounds.top) / bounds.height) * canvas.height,
  }
}
