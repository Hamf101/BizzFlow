"use client"

import { NumberField } from "@base-ui/react/number-field"
import type { ReactElement, ReactNode } from "react"

import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { maxMargin, paragraphGap, resizeTemplateLayout, resolvePageGeometry } from "@/services/templates/template-render-plan"
import type { TemplateLayout } from "@/types/template"

const MARGIN_SIDES = [
  ["top", "Top"],
  ["bottom", "Bottom"],
  ["left", "Left"],
  ["right", "Right"],
] as const

/**
 * The page's paper, margins and spacing, and what prints on every page. Paper
 * and orientation changes keep the content in proportion, so nothing breaks.
 * Margins come as a preset or in points for each side, as dragging the page's
 * margin guides sets them.
 *
 * @param props - The layout and how to change it.
 * @returns The page setup controls.
 */
export function PageSetupPanel({
  layout,
  onChange,
}: {
  layout: TemplateLayout
  onChange: (layout: TemplateLayout, coalesceKey?: string) => void
}): ReactElement {
  const geometry = resolvePageGeometry(layout)

  return (
    <div className="grid gap-3.5" data-slot="page-setup">
      <Row label="Paper">
        <Select
          aria-label="Paper"
          className="w-32 md:h-9"
          onChange={(event) =>
            onChange(resizeTemplateLayout(layout, { pageSize: event.target.value as TemplateLayout["pageSize"] }))
          }
          value={layout.pageSize}
        >
          <option value="A4">A4</option>
          <option value="Letter">Letter</option>
          <option value="Legal">Legal</option>
          <option value="A5">A5</option>
          <option value="A3">A3</option>
        </Select>
      </Row>
      <Choice
        label="Orientation"
        onChange={(orientation) => onChange(resizeTemplateLayout(layout, { orientation }))}
        options={[
          ["portrait", "Portrait"],
          ["landscape", "Landscape"],
        ]}
        value={layout.orientation}
      />
      <Choice
        label="Margins"
        onChange={(marginPreset) => onChange({ ...layout, marginPreset, margins: undefined })}
        options={[
          ["compact", "Narrow"],
          ["standard", "Normal"],
          ["generous", "Wide"],
        ]}
        // Margins set side by side match no preset.
        value={layout.margins ? null : layout.marginPreset}
      />
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {MARGIN_SIDES.map(([side, label]) => (
          <label className="flex items-center justify-between gap-2 text-sm text-muted-foreground" key={side}>
            {label}
            <Points
              label={`${label} margin, in points`}
              max={maxMargin(geometry, side)}
              min={0}
              onChange={(value) => onChange({ ...layout, margins: { ...geometry.margins, [side]: value } }, `margin:${side}`)}
              unit="pt"
              value={Math.round(geometry.margins[side])}
            />
          </label>
        ))}
      </div>
      <Row label="Line spacing">
        <Points
          label="Line spacing"
          max={3}
          min={1}
          onChange={(lineSpacing) => onChange({ ...layout, lineSpacing }, "line-spacing")}
          step={0.05}
          value={layout.lineSpacing ?? 1.5}
        />
      </Row>
      <Row label="Space between paragraphs">
        <Points
          label="Space between paragraphs, in points"
          max={48}
          min={0}
          onChange={(paragraphSpacing) => onChange({ ...layout, paragraphSpacing }, "paragraph-spacing")}
          unit="pt"
          value={paragraphGap(layout)}
        />
      </Row>
      <Choice
        label="Answers"
        onChange={(fieldStyle) => onChange({ ...layout, fieldStyle })}
        options={[
          ["box", "Box"],
          ["line", "Line"],
          ["cell", "Cell"],
        ]}
        value={layout.fieldStyle ?? "box"}
      />
      <div className="grid gap-1 border-t border-border pt-2">
        <Toggle
          checked={layout.printedTitle.mode !== "none"}
          label="Title"
          onChange={(on) => onChange({ ...layout, printedTitle: on ? { mode: "linked" } : { mode: "none" } })}
        />
        <Toggle
          checked={layout.headerPolicy !== "none"}
          label="Header"
          onChange={(on) => onChange({ ...layout, headerPolicy: on ? "all_pages" : "none" })}
        />
        <Toggle
          checked={layout.footerPolicy !== "none" && layout.pageNumbering === "page_x_of_y"}
          label="Page numbers"
          onChange={(on) =>
            onChange(
              on
                ? { ...layout, footerPolicy: "all_pages", pageNumbering: "page_x_of_y" }
                : { ...layout, pageNumbering: "none" }
            )
          }
        />
      </div>
    </div>
  )
}

function Row({ children, label }: { children: ReactNode; label: string }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

// A number typed, stepped with the arrow keys, or nudged with the buttons.
// What is typed takes effect as it becomes a number in range.
function Points({
  label,
  max,
  min,
  onChange,
  step = 1,
  unit,
  value,
}: {
  label: string
  max: number
  min: number
  onChange: (value: number) => void
  step?: number
  unit?: string
  value: number
}): ReactElement {
  return (
    <NumberField.Root
      largeStep={step * 10}
      max={max}
      min={min}
      onValueChange={(next) => next !== null && onChange(Math.min(max, Math.max(min, next)))}
      smallStep={step}
      step={step}
      value={value}
    >
      <NumberField.Group className="flex h-8 w-20 items-center rounded-[8px] border border-input bg-card text-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
        <NumberField.Input aria-label={label} className="min-w-0 flex-1 bg-transparent pl-2 text-[13px] tabular-nums outline-none" />
        {unit ? <span className="pr-2 text-xs text-muted-foreground">{unit}</span> : null}
      </NumberField.Group>
    </NumberField.Root>
  )
}

function Choice<Value extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: Value) => void
  options: ReadonlyArray<readonly [Value, string]>
  value: Value | null
}): ReactElement {
  return (
    <Row label={label}>
      <div aria-label={label} className="inline-flex rounded-[10px] bg-muted p-0.5" role="radiogroup">
        {options.map(([option, text]) => (
          <button
            aria-checked={option === value}
            className={cn(
              "h-8 rounded-[8px] px-2.5 text-[13px] text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
              option === value && "bg-card text-foreground shadow-sm"
            )}
            key={option}
            onClick={() => onChange(option)}
            role="radio"
            type="button"
          >
            {text}
          </button>
        ))}
      </div>
    </Row>
  )
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}): ReactElement {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} size="sm" />
    </label>
  )
}
