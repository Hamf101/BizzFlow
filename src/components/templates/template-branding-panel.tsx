"use client"

import { ImageUp } from "lucide-react"
import Image from "next/image"
import { type ChangeEvent, type ReactElement, useState } from "react"

import { readTemplateImage } from "@/components/templates/template-image"
import { Select } from "@/components/ui/select"
import { Button, buttonVariants } from "@/components/ui/button"
import { ColorWheel } from "@/components/ui/color-wheel"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { TemplateBranding } from "@/types/template"

// Colours that read clearly on white paper, starting with the defaults. Kept in
// lower case, as the picker stores them.
const PAPER_COLORS = [
  "#252329",
  "#635273",
  "#1f3a5f",
  "#1d4e89",
  "#0f5257",
  "#2e5e3e",
  "#4d5a1e",
  "#8a4b08",
  "#9b2c2c",
  "#8c2155",
  "#5b3a8e",
  "#475569"
] as const

/**
 * The document's brand: its logo, organization name and colours.
 *
 * @param props - The branding and how to change it.
 * @returns The brand controls.
 */
export function TemplateBrandingPanel({
  branding,
  onChange
}: {
  branding: TemplateBranding
  onChange: (branding: TemplateBranding) => void
}): ReactElement {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleLogoChange(
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    setErrorMessage(null)

    try {
      const logoDataUrl = await readTemplateImage(file)
      onChange({ ...branding, logoDataUrl })
    } catch (error: unknown) {
      const reason =
        error instanceof Error ? error.message : "Unable to read logo."

      console.warn("template_branding_logo_read_failed", {
        fileName: file.name,
        reason
      })
      setErrorMessage(reason)
    } finally {
      event.target.value = ""
    }
  }

  return (
    <div className="grid gap-4">
      {branding.logoDataUrl && (
        <div className="flex items-center justify-between gap-3 rounded-[8px] border bg-muted/30 p-3">
          <Image
            alt="Current organization logo"
            className="h-auto max-h-10 w-auto max-w-28 object-contain"
            height={40}
            src={branding.logoDataUrl}
            unoptimized
            width={112}
          />
          <Button
            onClick={(): void => onChange({ ...branding, logoDataUrl: null })}
            size="sm"
            type="button"
            variant="ghost"
          >
            Remove logo
          </Button>
        </div>
      )}
      <Field>
        <FieldLabel htmlFor="branding-organization-name">
          Organization name
        </FieldLabel>
        <Input
          id="branding-organization-name"
          maxLength={160}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange({ ...branding, organizationName: event.target.value })
          }
          value={branding.organizationName}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <ColorControl
          id="branding-primary-color"
          label="Primary"
          onChange={(primaryColor: string): void =>
            onChange({ ...branding, primaryColor })
          }
          value={branding.primaryColor}
        />
        <ColorControl
          id="branding-accent-color"
          label="Accent"
          onChange={(accentColor: string): void =>
            onChange({ ...branding, accentColor })
          }
          value={branding.accentColor}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="branding-logo-alignment">
            Logo position
          </FieldLabel>
          <Select
            id="branding-logo-alignment"
            onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
              onChange({
                ...branding,
                logoAlignment: event.target.value as "left" | "center" | "right"
              })
            }
            value={branding.logoAlignment}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="branding-logo-width">
            Logo size · {branding.logoWidthPercent}%
          </FieldLabel>
          <input
            className="h-9 w-full accent-primary"
            id="branding-logo-width"
            max={60}
            min={10}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              onChange({
                ...branding,
                logoWidthPercent: Number(event.target.value)
              })
            }
            type="range"
            value={branding.logoWidthPercent}
          />
        </Field>
      </div>
      <div className="grid gap-1.5">
        <label
          className={cn(
            buttonVariants({ size: "sm", variant: "outline" }),
            "w-fit cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/35"
          )}
        >
          <ImageUp />
          {branding.logoDataUrl ? "Replace logo" : "Upload logo"}
          <input
            accept="image/png,image/jpeg"
            aria-describedby={errorMessage ? "branding-logo-error" : "branding-logo-hint"}
            className="sr-only"
            id="branding-logo"
            onChange={handleLogoChange}
            type="file"
          />
        </label>
        <p className="text-xs text-muted-foreground" id="branding-logo-hint">
          PNG or JPEG
        </p>
        {errorMessage && (
          <p className="text-sm text-destructive" id="branding-logo-error" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Flow can reposition and resize an existing logo, but it preserves the
        image unless you explicitly ask to remove it.
      </p>
    </div>
  )
}

function ColorControl({
  id,
  label,
  onChange,
  value
}: {
  id: string
  label: string
  onChange: (value: string) => void
  value: string
}): ReactElement {
  // What is typed, which only becomes the colour once it is a whole hex code.
  const [typed, setTyped] = useState(value)

  function choose(color: string): void {
    setTyped(color)
    onChange(color)
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Popover onOpenChange={(open: boolean): void => (open ? setTyped(value) : undefined)}>
        <PopoverTrigger
          className="flex h-9 items-center gap-2 rounded-[8px] border bg-card px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 data-popup-open:border-ring"
          id={id}
        >
          <span
            aria-hidden="true"
            className="size-5 rounded-[5px] border"
            style={{ backgroundColor: value }}
          />
          <span className="font-mono">{value.toUpperCase()}</span>
        </PopoverTrigger>
        <PopoverContent align="start" aria-label={label} className="grid w-60 gap-3">
          <ColorWheel label={label} onChange={choose} value={value} />
          <div className="grid grid-cols-6 gap-2">
            {PAPER_COLORS.map((color: string) => (
              <button
                aria-label={color}
                aria-pressed={color === value.toLowerCase()}
                className="size-7 rounded-[7px] border outline-none ring-offset-2 ring-offset-popover focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:ring-2 aria-pressed:ring-foreground/70"
                key={color}
                onClick={(): void => choose(color)}
                style={{ backgroundColor: color }}
                type="button"
              />
            ))}
          </div>
          <Input
            aria-label="Hex code"
            className="font-mono uppercase"
            maxLength={7}
            onChange={(event: ChangeEvent<HTMLInputElement>): void => {
              const next = event.target.value.startsWith("#")
                ? event.target.value
                : `#${event.target.value}`

              setTyped(next)

              if (/^#[0-9a-f]{6}$/i.test(next)) {
                onChange(next.toLowerCase())
              }
            }}
            value={typed}
          />
        </PopoverContent>
      </Popover>
    </Field>
  )
}
