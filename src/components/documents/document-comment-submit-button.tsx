"use client"

import type { ReactElement } from "react"
import { useFormStatus } from "react-dom"

import { PermissionButton } from "@/components/auth/permission-button"
import type { OrganizationRole } from "@/lib/permissions"

type DocumentCommentSubmitButtonProps = {
  role: OrganizationRole
}

/**
 * Prevents repeat submissions while an immutable document comment is saving.
 *
 * @param props - Current organization role used for permission enforcement.
 * @returns Permission-aware comment submit button with pending feedback.
 */
export function DocumentCommentSubmitButton({
  role,
}: DocumentCommentSubmitButtonProps): ReactElement | null {
  const { pending } = useFormStatus()

  return (
    <PermissionButton
      action="document_comments:create"
      disabled={pending}
      role={role}
      type="submit"
    >
      {pending ? "Adding comment" : "Add comment"}
    </PermissionButton>
  )
}
