import type { ComponentProps, ReactElement } from "react"

import { Button } from "@/components/ui/button"
import {
  canPerformOrganizationAction,
  type OrganizationPermissionAction,
  type OrganizationRole,
} from "@/lib/permissions"

type PermissionButtonProps = ComponentProps<typeof Button> & {
  role: OrganizationRole
  action: OrganizationPermissionAction
  deniedMode?: "hide" | "disable"
}

/**
 * Renders a button according to the current role's permission for an action.
 *
 * @param props - Button props plus role, permission action, and denied mode.
 * @returns A permitted button, disabled button, or null.
 */
export function PermissionButton({
  role,
  action,
  deniedMode = "hide",
  disabled,
  ...props
}: PermissionButtonProps): ReactElement | null {
  const isAllowed = canPerformOrganizationAction(role, action)

  if (!isAllowed && deniedMode === "hide") {
    return null
  }

  return <Button disabled={disabled || !isAllowed} {...props} />
}
