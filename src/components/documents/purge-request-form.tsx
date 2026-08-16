import { Trash2 } from "lucide-react"
import type { ReactElement } from "react"

import { PermissionButton } from "@/components/auth/permission-button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type {
  OrganizationPermissionAction,
  OrganizationRole,
} from "@/lib/permissions"

type PurgeRequestFormProps = {
  action: (formData: FormData) => Promise<void>
  confirmationFieldName: "confirmationName" | "confirmationTitle"
  hiddenFields: Record<string, string>
  inputId: string
  permissionAction: OrganizationPermissionAction
  resourceKind: "document" | "folder"
  resourceName: string
  role: OrganizationRole
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
  inputId,
  permissionAction,
  resourceKind,
  resourceName,
  role,
}: PurgeRequestFormProps): ReactElement {
  const confirmationLabel =
    resourceKind === "document" ? "document title" : "folder name"

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4"
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
      <PermissionButton
        action={permissionAction}
        aria-label={`Permanently delete ${resourceName}`}
        className="self-start"
        role={role}
        size="xs"
        type="submit"
        variant="destructive"
      >
        <Trash2 data-icon="inline-start" />
        Delete permanently
      </PermissionButton>
    </form>
  )
}
