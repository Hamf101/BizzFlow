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
import { Input } from "@/components/ui/input"

type DrawnSignatureFieldProps = {
  description?: string
  label: string
  name: string
  required?: boolean
}

// System handwriting faces first; any cursive face reads as a signature.
const TYPED_FONT = '64px "Snell Roundhand", "Segoe Script", "Brush Script MT", cursive'

/**
 * Captures a basic pointer-drawn signature or initials as a PNG data URL, or a
 * typed name written onto the same canvas, so a keyboard alone can sign and the
 * server receives the same kind of picture either way.
 *
 * @param props - Form field name, label, helper text, and required state.
 * @returns Responsive canvas with a hidden form value and clear control.
 */
export function DrawnSignatureField({
  description = "Draw with a mouse, finger, or stylus.",
  label,
  name,
  required = false,
}: DrawnSignatureFieldProps): ReactElement {
  const fieldId = useId()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const isDrawingRef = useRef<boolean>(false)
  const strokeChangedRef = useRef<boolean>(false)
  const [dataUrl, setDataUrl] = useState<string>("")
  const [typed, setTyped] = useState<string>("")

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

    // Drawing replaces a typed name, so the picture always matches what was last done.
    if (typed) {
      context.clearRect(0, 0, canvas.width, canvas.height)
      setTyped("")
      setDataUrl("")
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
    context.lineWidth = 3
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
    setTyped("")
  }

  function writeTypedName(value: string): void {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")

    setTyped(value)

    if (!canvas || !context) {
      return
    }

    context.clearRect(0, 0, canvas.width, canvas.height)

    if (value.trim() === "") {
      setDataUrl("")
      return
    }

    context.font = TYPED_FONT
    context.fillStyle = "#252329"
    context.textBaseline = "middle"
    // maxWidth squeezes a long name to fit rather than running off the picture.
    context.fillText(value.trim(), 24, canvas.height / 2, canvas.width - 48)
    setDataUrl(canvas.toDataURL("image/png"))
  }

  return (
    <Field>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel htmlFor={fieldId}>
          {label}
          {required ? " *" : ""}
        </FieldLabel>
        <Button
          disabled={!dataUrl && !typed}
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
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        ref={canvasRef}
        role="img"
        width={640}
      />
      <input name={name} type="hidden" value={dataUrl} />
      <FieldDescription>{description}</FieldDescription>
      <FieldLabel htmlFor={`${fieldId}-typed`}>Or type your {label.toLowerCase()}</FieldLabel>
      <Input
        autoComplete="off"
        id={`${fieldId}-typed`}
        maxLength={60}
        onChange={(event) => writeTypedName(event.target.value)}
        value={typed}
      />
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
