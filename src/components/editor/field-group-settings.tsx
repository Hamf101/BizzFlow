"use client"

import type { ChangeEvent, ReactElement } from "react"

import { CheckboxControl } from "@/components/templates/template-block-editor"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { TemplateFieldGroup } from "@/types/template"

import type { EditorController } from "./use-editor-controller"

/**
 * What a group of fields shares, set from any of its fields: a label printed
 * above the group, and whether the group stays on one page.
 *
 * @param props - The group and the editor's controller.
 * @returns The group's settings, under the field's own.
 */
export function FieldGroupSettings({
  controller,
  group,
}: {
  controller: EditorController
  group: TemplateFieldGroup
}): ReactElement {
  return (
    <div className="mt-4 grid gap-4 border-t border-border pt-4">
      <Field>
        <FieldLabel htmlFor={`${group.id}-group-label`}>Group label</FieldLabel>
        <Input
          id={`${group.id}-group-label`}
          maxLength={160}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            controller.updateGroup(group.id, { label: event.target.value }, `group:${group.id}`)
          }
          placeholder="Optional"
          value={group.label ?? ""}
        />
      </Field>
      <CheckboxControl
        checked={group.keepTogether}
        id={`${group.id}-group-keep`}
        label="Keep the group on one page"
        onChange={(keepTogether: boolean): void => controller.updateGroup(group.id, { keepTogether })}
      />
    </div>
  )
}
