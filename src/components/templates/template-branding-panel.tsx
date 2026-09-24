"use client"

import Image from "next/image"
import { type ChangeEvent, type ReactElement, useState } from "react"

import { readTemplateImage } from "@/components/templates/template-image"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { getPaperContrastRatio } from "@/lib/document-surface"
import type { TemplateBranding } from "@/types/template"

/**
 * The document's brand: its logo, organization name and colours, with how
 * well the colours read on white paper.
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
  const primaryContrast = getPaperContrastRatio(branding.primaryColor)
  const accentContrast = getPaperContrastRatio(branding.accentColor)
  const hasLowPaperContrast = primaryContrast < 4.5 || accentContrast < 4.5

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
          describedBy="branding-paper-contrast"
          id="branding-primary-color"
          label="Primary"
          onChange={(primaryColor: string): void =>
            onChange({ ...branding, primaryColor })
          }
          value={branding.primaryColor}
        />
        <ColorControl
          describedBy="branding-paper-contrast"
          id="branding-accent-color"
          label="Accent"
          onChange={(accentColor: string): void =>
            onChange({ ...branding, accentColor })
          }
          value={branding.accentColor}
        />
      </div>
      <Alert id="branding-paper-contrast" role="status" aria-atomic="true">
        <AlertTitle>
          {hasLowPaperContrast ? "Low paper contrast" : "Paper contrast"}
        </AlertTitle>
        <AlertDescription>
          <p>
            Primary {primaryContrast.toFixed(2)}:1 · Accent {accentContrast.toFixed(2)}:1
            {" "}against white paper.
          </p>
          {hasLowPaperContrast && (
            <p>
              Aim for 4.5:1 for normal text. You can still save; Preview and PDF
              keep your exact colors.
            </p>
          )}
        </AlertDescription>
      </Alert>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="branding-logo-alignment">
            Logo position
          </FieldLabel>
          <select
            className="h-9 w-full rounded-[8px] border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
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
          </select>
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
      <Field>
        <FieldLabel htmlFor="branding-logo">PNG or JPEG logo</FieldLabel>
        <Input
          accept="image/png,image/jpeg"
          aria-describedby={errorMessage ? "branding-logo-error" : undefined}
          id="branding-logo"
          onChange={handleLogoChange}
          type="file"
        />
        {errorMessage && (
          <p className="text-sm text-destructive" id="branding-logo-error">
            {errorMessage}
          </p>
        )}
      </Field>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Flow can reposition and resize an existing logo, but it preserves the
        image unless you explicitly ask to remove it.
      </p>
    </div>
  )
}

function ColorControl({
  describedBy,
  id,
  label,
  onChange,
  value
}: {
  describedBy: string
  id: string
  label: string
  onChange: (value: string) => void
  value: string
}): ReactElement {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <label
        className="flex h-9 cursor-pointer items-center gap-2 rounded-[8px] border bg-card px-2 text-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
        htmlFor={id}
      >
        <span
          aria-hidden="true"
          className="size-5 rounded-[5px] border"
          style={{ backgroundColor: value }}
        />
        <span className="font-mono">{value.toUpperCase()}</span>
        <input
          aria-describedby={describedBy}
          className="sr-only"
          id={id}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange(event.target.value)
          }
          type="color"
          value={value}
        />
      </label>
    </Field>
  )
}
