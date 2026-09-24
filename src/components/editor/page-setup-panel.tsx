"use client"

import type { ReactElement, ReactNode } from "react"

import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { resizeTemplateLayout } from "@/services/templates/template-render-plan"
import type { TemplateLayout } from "@/types/template"

/**
 * The page's paper, margins and what prints on every page. Paper and
 * orientation changes keep the content in proportion, so nothing breaks.
 *
 * @param props - The layout and how to change it.
 * @returns The page setup controls.
 */
export function PageSetupPanel({
  layout,
  onChange,
}: {
  layout: TemplateLayout
  onChange: (layout: TemplateLayout) => void
}): ReactElement {
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
        onChange={(marginPreset) => onChange({ ...layout, marginPreset })}
        options={[
          ["compact", "Narrow"],
          ["standard", "Normal"],
          ["generous", "Wide"],
        ]}
        value={layout.marginPreset}
      />
      <Choice
        label="Spacing"
        onChange={(density) => onChange({ ...layout, density })}
        options={[
          ["compact", "Tight"],
          ["balanced", "Normal"],
          ["comfortable", "Airy"],
        ]}
        value={layout.density}
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

function Choice<Value extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: Value) => void
  options: ReadonlyArray<readonly [Value, string]>
  value: Value
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
