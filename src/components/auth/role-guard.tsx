import type { ReactElement, ReactNode } from "react"

import {
  canPerformOrganizationAction,
  type OrganizationPermissionAction,
  type OrganizationRole,
} from "@/lib/permissions"

type RoleGuardProps = {
  role: OrganizationRole
  action: OrganizationPermissionAction
  fallback?: ReactNode
  children: ReactNode
}

/**
 * Renders children only when the current organization role can perform an action.
 *
 * @param props - Role, permission action, fallback, and guarded children.
 * @returns Guarded children, fallback content, or null.
 */
export function RoleGuard({
  role,
  action,
  fallback = null,
  children,
}: RoleGuardProps): ReactElement | null {
  if (!canPerformOrganizationAction(role, action)) {
    return fallback ? <>{fallback}</> : null
  }

  return <>{children}</>
}
