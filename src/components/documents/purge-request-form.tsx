import { Trash2 } from "lucide-react"
import type { ReactElement } from "react"

import { PermissionButton } from "@/components/auth/permission-button"
import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type {
  OrganizationPermissionAction,
  OrganizationPermissionSubject,
} from "@/lib/permissions"

type PurgeRequestFormProps = {
  action: (formData: FormData) => Promise<void>
  confirmationFieldName: "confirmationName" | "confirmationTitle"
  hiddenFields: Record<string, string>
  /** Lays the form out as a dialog's body and footer instead of a framed panel. */
  inDialog?: boolean
  inputId: string
  resourceName: string
} & (
  | {
      permissionAction: OrganizationPermissionAction
      resourceKind: "document" | "folder"
      role: OrganizationPermissionSubject
    }
  // A template's own access decides, which the service checks.
  | { resourceKind: "template" }
)

const CONFIRMATION_LABELS = { document: "document title", folder: "folder name", template: "template title" } as const
const LOSSES = {
  document: "Stored files are deleted and this document stops being recoverable.",
  folder: "Every document in this folder subtree is deleted and stops being recoverable.",
  template: "Documents made from it keep everything in them.",
} as const

/**
 * Renders the typed-confirmation form that requests permanent deletion.
 *
 * The exact name is only a slip guard; the service and database re-check the
 * actor's permission, access, and confirmation before anything is queued.
 *
 * @param props - Server action, tenant-scoped hidden fields, and resource name.
 * @returns The destructive confirmation form for the trashed resource.
 */
export function PurgeRequestForm(props: PurgeRequestFormProps): ReactElement {
  const { action, confirmationFieldName, hiddenFields, inDialog = false, inputId, resourceKind, resourceName } = props
  const button = {
    "aria-label": `Permanently delete ${resourceName}`,
    children: (
      <>
        <Trash2 data-icon="inline-start" />
        Delete permanently
      </>
    ),
    className: inDialog ? undefined : "self-start",
    size: inDialog ? ("default" as const) : ("xs" as const),
    type: "submit" as const,
    variant: "destructive" as const,
  }
  const submit =
    props.resourceKind === "template" ? (
      <Button {...button} />
    ) : (
      <PermissionButton {...button} action={props.permissionAction} role={props.role} />
    )

  return (
    <form
      action={action}
      className={
        inDialog
          ? "grid gap-5"
          : "flex flex-col gap-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4"
      }
    >
      {Object.entries(hiddenFields).map(
        ([fieldName, fieldValue]: [string, string]): ReactElement => (
          <input
            key={fieldName}
            name={fieldName}
            type="hidden"
            value={fieldValue}
          />
        )
      )}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={inputId}>
            Type the exact {CONFIRMATION_LABELS[resourceKind]} to delete permanently
          </FieldLabel>
          <Input
            autoComplete="off"
            id={inputId}
            name={confirmationFieldName}
            placeholder={resourceName}
            required
            type="text"
          />
          <FieldDescription>
            {LOSSES[resourceKind]} This cannot be undone.
          </FieldDescription>
        </Field>
      </FieldGroup>
      {inDialog ? <DialogFooter>{submit}</DialogFooter> : submit}
    </form>
  )
}
