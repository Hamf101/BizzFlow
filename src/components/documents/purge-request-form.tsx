import { Trash2 } from "lucide-react"
import type { ReactElement } from "react"

import { PermissionButton } from "@/components/auth/permission-button"
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
  permissionAction: OrganizationPermissionAction
  resourceKind: "document" | "folder"
  resourceName: string
  role: OrganizationPermissionSubject
}

/**
 * Renders the typed-confirmation form that requests permanent deletion.
 *
 * The exact name is only a slip guard; the service and database re-check the
 * actor's permission, access, and confirmation before anything is queued.
 *
 * @param props - Server action, tenant-scoped hidden fields, and resource name.
 * @returns The destructive confirmation form for the trashed resource.
 */
export function PurgeRequestForm({
  action,
  confirmationFieldName,
  hiddenFields,
  inDialog = false,
  inputId,
  permissionAction,
  resourceKind,
  resourceName,
  role,
}: PurgeRequestFormProps): ReactElement {
  const confirmationLabel =
    resourceKind === "document" ? "document title" : "folder name"
  const submit = (
    <PermissionButton
      action={permissionAction}
      aria-label={`Permanently delete ${resourceName}`}
      className={inDialog ? undefined : "self-start"}
      role={role}
      size={inDialog ? "default" : "xs"}
      type="submit"
      variant="destructive"
    >
      <Trash2 data-icon="inline-start" />
      Delete permanently
    </PermissionButton>
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
            Type the exact {confirmationLabel} to delete permanently
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
            {resourceKind === "document"
              ? "Stored files are deleted and this document stops being recoverable."
              : "Every document in this folder subtree is deleted and stops being recoverable."}{" "}
            This cannot be undone.
          </FieldDescription>
        </Field>
      </FieldGroup>
      {inDialog ? <DialogFooter>{submit}</DialogFooter> : submit}
    </form>
  )
}
