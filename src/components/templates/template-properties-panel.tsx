import type { ChangeEvent, ReactElement } from "react"

import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { TemplateLayout } from "@/types/template"

const CONTROL_CLASS_NAME =
  "h-8 w-full rounded-lg border border-input bg-card px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"

type TemplatePropertiesPanelProps = {
  layout: TemplateLayout
  onChange: (layout: TemplateLayout) => void
}

/**
 * Edits version-three print and repeated-region layout controls.
 *
 * @param props - Current resolved layout and an immutable change callback.
 * @returns Accessible page, spacing, title, header, and footer controls.
 */
export function TemplatePropertiesPanel({
  layout,
  onChange
}: TemplatePropertiesPanelProps): ReactElement {
  return (
    <div className="grid gap-5">
      <fieldset className="grid gap-4">
        <legend className="text-sm font-semibold">Page</legend>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <Field>
            <FieldLabel htmlFor="template-page-size">Page size</FieldLabel>
            <select
              className={CONTROL_CLASS_NAME}
              id="template-page-size"
              onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                onChange({
                  ...layout,
                  pageSize: event.target.value as TemplateLayout["pageSize"]
                })
              }
              value={layout.pageSize}
            >
              <option value="A3">A3</option>
              <option value="A4">A4</option>
              <option value="A5">A5</option>
              <option value="Letter">Letter</option>
              <option value="Legal">Legal</option>
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="template-orientation">Orientation</FieldLabel>
            <select
              className={CONTROL_CLASS_NAME}
              id="template-orientation"
              onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                onChange({
                  ...layout,
                  orientation: event.target
                    .value as TemplateLayout["orientation"]
                })
              }
              value={layout.orientation}
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="template-margins">Margins</FieldLabel>
            <select
              className={CONTROL_CLASS_NAME}
              id="template-margins"
              onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                onChange({
                  ...layout,
                  marginPreset: event.target
                    .value as TemplateLayout["marginPreset"]
                })
              }
              value={layout.marginPreset}
            >
              <option value="compact">Compact</option>
              <option value="standard">Standard</option>
              <option value="generous">Generous</option>
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="template-density">Density</FieldLabel>
            <select
              className={CONTROL_CLASS_NAME}
              id="template-density"
              onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                onChange({
                  ...layout,
                  density: event.target.value as TemplateLayout["density"]
                })
              }
              value={layout.density}
            >
              <option value="compact">Compact</option>
              <option value="balanced">Balanced</option>
              <option value="comfortable">Comfortable</option>
            </select>
          </Field>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 border-t border-border pt-5">
        <legend className="text-sm font-semibold">Printed title</legend>
        <Field>
          <FieldLabel htmlFor="template-title-mode">Title source</FieldLabel>
          <select
            className={CONTROL_CLASS_NAME}
            id="template-title-mode"
            onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
              onChange({
                ...layout,
                printedTitle:
                  event.target.value === "custom"
                    ? { mode: "custom", text: "Custom document title" }
                    : { mode: "linked" }
              })
            }
            value={layout.printedTitle.mode}
          >
            <option value="linked">Use template title</option>
            <option value="custom">Use custom printed title</option>
          </select>
        </Field>
        {layout.printedTitle.mode === "custom" && (
          <Field>
            <FieldLabel htmlFor="template-custom-title">
              Custom title
            </FieldLabel>
            <Input
              id="template-custom-title"
              maxLength={500}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                onChange({
                  ...layout,
                  printedTitle: {
                    mode: "custom",
                    text: event.target.value
                  }
                })
              }
              required
              value={layout.printedTitle.text}
            />
          </Field>
        )}
      </fieldset>

      <fieldset className="grid gap-4 border-t border-border pt-5">
        <legend className="text-sm font-semibold">Repeated regions</legend>
        <Field>
          <FieldLabel htmlFor="template-header-policy">Header</FieldLabel>
          <select
            className={CONTROL_CLASS_NAME}
            id="template-header-policy"
            onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
              onChange({
                ...layout,
                headerPolicy: event.target
                  .value as TemplateLayout["headerPolicy"]
              })
            }
            value={layout.headerPolicy}
          >
            <option value="first_page">First page</option>
            <option value="all_pages">All pages</option>
            <option value="none">None</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="template-footer-policy">Footer</FieldLabel>
          <select
            className={CONTROL_CLASS_NAME}
            id="template-footer-policy"
            onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
              onChange({
                ...layout,
                footerPolicy: event.target
                  .value as TemplateLayout["footerPolicy"]
              })
            }
            value={layout.footerPolicy}
          >
            <option value="first_page">First page</option>
            <option value="all_pages">All pages</option>
            <option value="none">None</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="template-page-numbering">
            Page numbering
          </FieldLabel>
          <select
            className={CONTROL_CLASS_NAME}
            id="template-page-numbering"
            onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
              onChange({
                ...layout,
                pageNumbering: event.target
                  .value as TemplateLayout["pageNumbering"]
              })
            }
            value={layout.pageNumbering}
          >
            <option value="page_x_of_y">Page X of Y</option>
            <option value="none">None</option>
          </select>
        </Field>
      </fieldset>
    </div>
  )
}
